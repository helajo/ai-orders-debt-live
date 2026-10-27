/* AI Orders & Debt Map: live relationship graph of orders, investments and debt.
   Reads data/graph.json (published site) or ../data/graph.json (repo served locally, page at /site/).
   ?snapshot=YYYY-MM-DD reads data/archive/YYYY-MM-DD.json instead (no auto-refresh).
   Re-fetches every 5 minutes without losing zoom or selection. */
(function () {
  "use strict";

  var I = window.I18N;
  var KIND_ORDER = ["order", "investment", "debt", "vendor_financing", "lease", "guarantee"];
  var GROUP_ORDER = ["hyperscaler", "model_lab", "chip", "neocloud", "datacenter", "energy", "financier", "spv", "other"];
  /* ring order for the layout anchors: neighbours on the ring trade most with each other */
  var GROUP_RING = ["chip", "model_lab", "hyperscaler", "neocloud", "datacenter", "energy", "spv", "financier", "other"];
  var REFRESH_MS = 5 * 60 * 1000;
  var STALE_MS = 6 * 60 * 60 * 1000;
  var DATA_PATHS = ["data/graph.json", "../data/graph.json"];
  var SNAPSHOT = (function () {
    var m = /[?&]snapshot=(\d{4}-\d{2}-\d{2})(?:&|$)/.exec(location.search);
    return m ? m[1] : null;
  })();
  var MIN_OPTIONS = [0, 1e9, 1e10, 5e10, 1e11];
  var LS_LANG = "aod.lang";
  var LS_SEEN = "aod.seenEdges";

  /* ---------- small helpers ---------- */
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  };
  function $(id) { return document.getElementById(id); }
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "text") el.textContent = v;
        else if (k === "class") el.className = v;
        else if (k === "style") el.setAttribute("style", v);
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : v);
      });
    }
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }
  function safeUrl(u) {
    return typeof u === "string" && /^https?:\/\//i.test(u) ? u : null;
  }
  function extLink(url, text, cls) {
    var u = safeUrl(url);
    if (!u) return h("span", { class: cls, text: text });
    return h("a", { href: u, target: "_blank", rel: "noopener noreferrer", class: cls, text: text });
  }
  function hostOf(u) {
    try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
  }
  function isoDay(d) { return d.toISOString().slice(0, 10); }
  function cssVar(prefix, key) { return "var(--" + prefix + "-" + key + ")"; }
  function kindColor(k) { return KIND_ORDER.indexOf(k) >= 0 ? cssVar("k", k) : "var(--muted)"; }
  function groupColor(g) { return GROUP_ORDER.indexOf(g) >= 0 ? cssVar("g", g) : "var(--g-other)"; }

  /* ---------- state ---------- */
  function initialLang() {
    var s = store.get(LS_LANG);
    if (s === "en" || s === "zh") return s;
    var nl = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
    return /^zh/i.test(nl) ? "zh" : "en";
  }

  var state = {
    lang: initialLang(),
    raw: null,
    sample: false,
    source: null,
    fetchFailed: false,
    lastFetch: 0,
    stamp: null,
    ents: new Map(),
    edges: [],
    edgeById: new Map(),
    prevIds: null,
    newIds: new Set(),
    filters: defaultFilters(),
    view: "graph",
    sel: null,
    hover: null,
    sort: { key: "date", dir: -1 },
    visible: [],
    visibleNodes: []
  };

  function defaultFilters() {
    return { kinds: new Set(KIND_ORDER), group: "", min: 0, period: "all", from: "", to: "", unverified: true, q: "" };
  }

  function t(key, vars) { return I.t(state.lang, key, vars); }
  function usd(n, compact) { return I.fmtUSD(n, state.lang, { compact: compact }); }
  function day(s) { return I.fmtDate(s, state.lang); }
  function entName(id) {
    var e = state.ents.get(id);
    if (!e) return id;
    return (state.lang === "zh" ? e.name_zh : e.name) || e.name || id;
  }
  /* graph label: the name without its parenthetical ("SpaceX (incl. xAI)" -> "SpaceX") */
  function shortName(id) {
    var full = entName(id);
    var s = full.replace(/\s*[（(][^）)]*[)）]\s*/g, " ").replace(/\s+/g, " ").trim();
    return s || full;
  }
  /* unverified candidates never merge with curated deals, so they stay dashed */
  function bundleKey(e) { return e.from + "|" + e.to + "|" + e.kind + (e.origin === "candidate" ? "|u" : ""); }
  function edgeTitle(e) { return (state.lang === "zh" ? e.title_zh : e.title_en) || e.title_en || e.title_zh || e.id; }
  function edgeSummary(e) { return (state.lang === "zh" ? e.summary_zh : e.summary_en) || e.summary_en || e.summary_zh || ""; }

  /* ---------- data loading ---------- */
  function fetchJSON(url) {
    var u = url + (url.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now();
    return fetch(u, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(url + " " + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || !Array.isArray(j.entities) || !Array.isArray(j.edges)) throw new Error(url + " has no entities/edges");
      return j;
    });
  }

  function tryPaths(paths) {
    var i = 0;
    function next() {
      if (i >= paths.length) return Promise.reject(new Error("no data"));
      var p = paths[i++];
      return fetchJSON(p).then(function (j) { return { json: j, path: p }; }, next);
    }
    return next();
  }

  function load() {
    var live = $("live");
    live.setAttribute("data-busy", "1");
    var base = DATA_PATHS.map(function (p) { return SNAPSHOT ? p.replace("graph.json", "archive/" + SNAPSHOT + ".json") : p; });
    var paths = /\/site\/(index\.html)?$/.test(location.pathname) ? base.slice().reverse() : base.slice();
    if (state.source) {
      paths = [state.source].concat(paths.filter(function (p) { return p !== state.source; }));
    }
    return tryPaths(paths).then(function (res) {
      state.fetchFailed = false;
      ingest(res.json, res.path, !!SNAPSHOT);
    }, function () {
      state.fetchFailed = true;
      if (!state.raw) $("error-banner").hidden = false;
    }).then(function () {
      state.lastFetch = Date.now();
      live.removeAttribute("data-busy");
      renderLive();
    });
  }

  function ingest(json, path, sample) {
    var stamp = (json.generated_at || "") + "|" + ((json.monitor && json.monitor.last_run) || "") + "|" + json.edges.length;
    var first = !state.raw;
    state.source = path;
    state.sample = sample;
    $("sample-banner").hidden = !SNAPSHOT;
    $("error-banner").hidden = true;
    if (!first && stamp === state.stamp && !sample) { state.raw = json; return; }
    state.stamp = stamp;
    state.raw = json;

    var ents = new Map();
    json.entities.forEach(function (e) { if (e && e.id) ents.set(e.id, e); });
    var edges = [];
    json.edges.forEach(function (e) {
      if (!e || !e.id || !e.from || !e.to || e.from === e.to) return;
      [e.from, e.to].forEach(function (id) {
        if (!ents.has(id)) ents.set(id, { id: id, name: id, name_zh: id, group: "other", ticker: null, country: null });
      });
      if (!e.origin) e.origin = e.confidence === "unverified" ? "candidate" : "curated";
      if (typeof e.amount_usd !== "number" || !isFinite(e.amount_usd) || e.amount_usd <= 0) e.amount_usd = null;
      if (!Array.isArray(e.sources)) e.sources = [];
      edges.push(e);
    });
    state.ents = ents;
    state.edges = edges;
    state.edgeById = new Map(edges.map(function (e) { return [e.id, e]; }));

    /* "new" = not seen in the previous fetch this session, or (first load) since the last visit */
    var ids = new Set(edges.map(function (e) { return e.id; }));
    if (!sample) {
      if (state.prevIds) {
        ids.forEach(function (id) { if (!state.prevIds.has(id)) state.newIds.add(id); });
      } else {
        var seenRaw = store.get(LS_SEEN);
        if (seenRaw) {
          try {
            var seen = new Set(JSON.parse(seenRaw));
            ids.forEach(function (id) { if (!seen.has(id)) state.newIds.add(id); });
          } catch (e) { /* ignore bad storage */ }
        }
      }
      store.set(LS_SEEN, JSON.stringify(Array.from(ids)));
    }
    state.newIds.forEach(function (id) { if (!ids.has(id)) state.newIds.delete(id); });
    state.prevIds = ids;

    if (state.sel) {
      var gone = state.sel.type === "node" ? !ents.has(state.sel.id)
        : state.sel.type === "bundle" ? !bundleEdges(state.sel.id, edges).length : !state.edgeById.has(state.sel.id);
      if (gone) state.sel = null;
    }
    if (first) readHash();
    buildFilterControls();
    renderAll(first);
  }

  /* ---------- filtering ---------- */
  function edgeVisible(e) {
    var f = state.filters;
    if (!f.kinds.has(e.kind)) return false;
    if (!f.unverified && e.origin === "candidate") return false;
    if (f.min > 0 && !(e.amount_usd >= f.min)) return false;
    var d = e.announced || "";
    if (f.from && (!d || d < f.from)) return false;
    if (f.to && (!d || d > f.to)) return false;
    var a = state.ents.get(e.from), b = state.ents.get(e.to);
    if (f.group && a.group !== f.group && b.group !== f.group) return false;
    if (f.q) {
      var hay = [e.title_en, e.title_zh, e.subkind, e.id, a.name, a.name_zh, a.ticker, a.id, b.name, b.name_zh, b.ticker, b.id]
        .join(" ").toLowerCase();
      if (hay.indexOf(f.q) < 0) return false;
    }
    return true;
  }

  function computeVisible() {
    state.visible = state.edges.filter(edgeVisible);
    var exp = new Map();
    state.visible.forEach(function (e) {
      [e.from, e.to].forEach(function (id) {
        if (!exp.has(id)) exp.set(id, { total: 0, inflow: 0, outflow: 0, deals: 0, byKind: {} });
      });
      var a = e.amount_usd || 0;
      var s = exp.get(e.from), r = exp.get(e.to);
      s.outflow += a; s.total += a; s.deals++; s.byKind[e.kind] = (s.byKind[e.kind] || 0) + a;
      r.inflow += a; r.total += a; r.deals++; r.byKind[e.kind] = (r.byKind[e.kind] || 0) + a;
    });
    state.exposure = exp;
    state.visibleNodes = Array.from(exp.keys());
  }

  /* ---------- static labels ---------- */
  function applyStatic() {
    var zh = state.lang === "zh";
    document.documentElement.lang = zh ? "zh-CN" : "en";
    document.title = t("doc_title");
    document.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = t(el.getAttribute("data-i18n")); });
    document.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      var s = t(el.getAttribute("data-i18n-title"));
      el.title = s; el.setAttribute("aria-label", s);
    });
    $("f-search").placeholder = t("f_search_ph");
    $("lang-en").setAttribute("aria-pressed", String(!zh));
    $("lang-zh").setAttribute("aria-pressed", String(zh));
    $("graph-svg").setAttribute("aria-label", t("brand"));
    document.querySelector(".skip").textContent = zh ? "跳到关系图" : "Skip to graph";
  }

  function buildFilterControls() {
    var f = state.filters;
    var counts = {};
    state.edges.forEach(function (e) { counts[e.kind] = (counts[e.kind] || 0) + 1; });
    var chips = $("kind-chips");
    chips.textContent = "";
    KIND_ORDER.forEach(function (k) {
      chips.appendChild(h("button", {
        type: "button", class: "chip", "aria-pressed": String(f.kinds.has(k)), style: "--c:" + kindColor(k),
        onclick: function () {
          if (f.kinds.has(k)) f.kinds.delete(k); else f.kinds.add(k);
          this.setAttribute("aria-pressed", String(f.kinds.has(k)));
          renderAll(false);
        }
      }, [h("span", { class: "chip__sw", "aria-hidden": "true" }), I.kind(state.lang, k), h("span", { class: "chip__n", text: String(counts[k] || 0) })]));
    });

    var groups = new Set();
    state.ents.forEach(function (e) { groups.add(e.group); });
    var gs = $("f-group");
    gs.textContent = "";
    gs.appendChild(h("option", { value: "", text: t("f_group_all") }));
    GROUP_ORDER.forEach(function (g) {
      if (groups.has(g)) gs.appendChild(h("option", { value: g, text: I.group(state.lang, g) }));
    });
    gs.value = groups.has(f.group) ? f.group : "";

    var ms = $("f-min");
    ms.textContent = "";
    MIN_OPTIONS.forEach(function (m) {
      ms.appendChild(h("option", { value: String(m), text: m ? "≥ " + usd(m) : t("f_min_any") }));
    });
    ms.value = String(f.min);

    var ps = $("f-period");
    ps.textContent = "";
    [["all", "f_period_all"], ["365", "f_period_365"], ["90", "f_period_90"], ["2026", "f_period_2026"], ["2025", "f_period_2025"], ["custom", "f_period_custom"]]
      .forEach(function (p) { ps.appendChild(h("option", { value: p[0], text: t(p[1]) })); });
    ps.value = f.period;
    $("f-from").value = f.from;
    $("f-to").value = f.to;
    $("f-unverified").checked = f.unverified;
    $("f-search").value = f.q;
  }

  function setPeriod(p) {
    var f = state.filters, now = new Date();
    f.period = p;
    if (p === "all") { f.from = ""; f.to = ""; }
    else if (p === "365" || p === "90") { f.from = isoDay(new Date(now.getTime() - Number(p) * 864e5)); f.to = ""; }
    else if (/^\d{4}$/.test(p)) { f.from = p + "-01-01"; f.to = p + "-12-31"; }
    $("f-from").value = f.from;
    $("f-to").value = f.to;
  }

  function wireControls() {
    $("lang-en").addEventListener("click", function () { setLang("en"); });
    $("lang-zh").addEventListener("click", function () { setLang("zh"); });
    var qTimer;
    $("f-search").addEventListener("input", function () {
      var v = this.value;
      clearTimeout(qTimer);
      qTimer = setTimeout(function () { state.filters.q = v.trim().toLowerCase(); renderAll(false); }, 160);
    });
    $("f-group").addEventListener("change", function () { state.filters.group = this.value; renderAll(false); });
    $("f-min").addEventListener("change", function () { state.filters.min = Number(this.value) || 0; renderAll(false); });
    $("f-period").addEventListener("change", function () { setPeriod(this.value); renderAll(false); });
    $("f-from").addEventListener("change", function () { state.filters.from = this.value; state.filters.period = "custom"; $("f-period").value = "custom"; renderAll(false); });
    $("f-to").addEventListener("change", function () { state.filters.to = this.value; state.filters.period = "custom"; $("f-period").value = "custom"; renderAll(false); });
    $("f-unverified").addEventListener("change", function () { state.filters.unverified = this.checked; renderAll(false); });
    $("f-reset").addEventListener("click", function () {
      state.filters = defaultFilters();
      buildFilterControls();
      renderAll(false);
    });
    $("f-more").addEventListener("click", function () {
      var open = this.getAttribute("aria-expanded") !== "true";
      this.setAttribute("aria-expanded", String(open));
      document.querySelector(".filters").classList.toggle("is-open", open);
    });
    $("tab-graph").addEventListener("click", function () { setView("graph"); });
    $("tab-table").addEventListener("click", function () { setView("table"); });
    [$("tab-graph"), $("tab-table")].forEach(function (b) {
      b.addEventListener("keydown", function (ev) {
        if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
          var other = b.id === "tab-graph" ? $("tab-table") : $("tab-graph");
          other.focus(); other.click();
        }
      });
    });
    $("csv").addEventListener("click", downloadCSV);
    $("zoom-in").addEventListener("click", function () { G.svg.transition().duration(250).call(G.zoom.scaleBy, 1.35); });
    $("zoom-out").addEventListener("click", function () { G.svg.transition().duration(250).call(G.zoom.scaleBy, 1 / 1.35); });
    $("zoom-fit").addEventListener("click", function () { fitView(true); });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && state.sel) { select(null); }
    });
    window.addEventListener("hashchange", function () { readHash(); renderSelection(); renderPanel(); });
    document.addEventListener("visibilitychange", function () {
      if (!SNAPSHOT && !document.hidden && Date.now() - state.lastFetch > REFRESH_MS) load();
    });
  }

  function setLang(l) {
    if (l === state.lang) return;
    state.lang = l;
    store.set(LS_LANG, l);
    applyStatic();
    buildFilterControls();
    renderAll(false, true);
  }

  function setView(v) {
    state.view = v;
    $("tab-graph").setAttribute("aria-selected", String(v === "graph"));
    $("tab-table").setAttribute("aria-selected", String(v === "table"));
    $("tab-graph").tabIndex = v === "graph" ? 0 : -1;
    $("tab-table").tabIndex = v === "table" ? 0 : -1;
    $("graph-view").hidden = v !== "graph";
    $("table-view").hidden = v !== "table";
    $("graph-tools").hidden = v !== "graph";
    $("legend").hidden = v !== "graph";
    $("csv").hidden = v !== "table";
    if (v === "table") renderTable();
  }

  /* ---------- selection & hash ---------- */
  function select(sel, opts) {
    state.sel = sel;
    var hash = sel ? ({ node: "n-", edge: "e-", bundle: "b-" }[sel.type]) + sel.id : "";
    try {
      history.replaceState(null, "", hash ? "#" + hash : location.pathname + location.search);
    } catch (e) { /* sandboxed */ }
    renderSelection();
    renderPanel();
    if (state.view === "table") renderTable();
    if (sel && opts && opts.reveal && window.matchMedia("(max-width: 1080px)").matches) {
      $("panel").scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }
  }

  function readHash() {
    var m = /^#([neb])-(.+)$/.exec(location.hash || "");
    if (!m) return;
    var id = decodeURIComponent(m[2]);
    if (m[1] === "n" && state.ents.has(id)) state.sel = { type: "node", id: id };
    if (m[1] === "e" && state.edgeById.has(id)) state.sel = { type: "edge", id: id };
    if (m[1] === "b" && bundleEdges(id, state.edges).length) state.sel = { type: "bundle", id: id };
  }

  function bundleEdges(bk, list) {
    return (list || state.visible).filter(function (e) { return bundleKey(e) === bk; })
      .sort(function (a, b) { return (b.amount_usd || 0) - (a.amount_usd || 0); });
  }

  /* ---------- render orchestration ---------- */
  function renderAll(first, langOnly) {
    computeVisible();
    renderSummary();
    renderGraph(first, langOnly);
    renderPanel();
    renderFeeds();
    if (state.view === "table") renderTable();
    var n = state.visible.length;
    var f = state.filters, act = 0;
    if (f.group) act++; if (f.min) act++; if (f.from || f.to) act++; if (!f.unverified) act++; if (f.q) act++;
    $("f-more-n").textContent = act ? t("f_active", { n: act }) : "";
    $("viz-count").textContent = t("t_count", { n: n }) + (n !== state.edges.length ? " / " + state.edges.length : "");
    renderLive();
  }

  function renderSummary() {
    var sums = { order: 0, investment: 0, debt: 0 }, nulls = { order: 0, investment: 0, debt: 0 };
    state.visible.forEach(function (e) {
      if (!(e.kind in sums)) return;
      if (e.amount_usd) sums[e.kind] += e.amount_usd; else nulls[e.kind]++;
    });
    ["order", "investment", "debt"].forEach(function (k) {
      $("sum-" + k).textContent = usd(sums[k]);
      $("sum-" + k + "-note").textContent = nulls[k] ? t("sum_undisclosed", { n: nulls[k] }) : "";
    });
    $("sum-deals").textContent = String(state.visible.length);
    $("sum-entities").textContent = String(state.visibleNodes.length);
    var filtered = state.visible.length !== state.edges.length;
    $("sum-scope").textContent = filtered ? t("sum_scope_filtered") : t("sum_scope_all");
    var nn = state.newIds.size;
    var note = $("sum-new");
    note.textContent = nn ? (nn === 1 ? t("new_edges_one") : t("new_edges", { n: nn })) : "";
    note.className = "tile__note" + (nn ? " tile__note--new" : "");
  }

  /* ---------- live status ---------- */
  function renderLive() {
    var raw = state.raw;
    var live = $("live");
    if (!raw) {
      live.setAttribute("data-state", "offline");
      $("live-state").textContent = t("offline");
      $("live-text").textContent = "";
      return;
    }
    var gen = raw.generated_at;
    var mon = raw.monitor || {};
    var genD = I.parseISO(gen);
    var st = "live";
    if (state.fetchFailed) st = "offline";
    else if (SNAPSHOT) st = "stale";
    else if (!genD || Date.now() - genD.getTime() > STALE_MS) st = "stale";
    live.setAttribute("data-state", st);
    $("live-state").textContent = SNAPSHOT ? t("snapshot") : t(st);
    $("live-text").textContent = t("updated", { t: I.ago(gen, state.lang) });
    live.title = gen ? I.fmtDateTime(gen, state.lang) : "";

    var line = $("monitor-line");
    line.textContent = "";
    line.appendChild(h("span", { title: mon.last_run ? I.fmtDateTime(mon.last_run, state.lang) : null }, [mon.last_run ? t("monitor_ran", { t: I.ago(mon.last_run, state.lang) }) : t("monitor_never")]));
    line.appendChild(h("span", { text: t("monitor_counts", { sec: num(mon.sec_items), news: num(mon.news_items), cand: num(mon.candidates) }) }));
    line.appendChild(h("span", { class: "pill" + (mon.claude_enabled ? " pill--on" : ""), text: mon.claude_enabled ? t("claude_on") : t("claude_off") }));
    var srcs = mon.sources || {};
    [["sec", "src_sec"], ["news", "src_news"]].forEach(function (k) {
      var st = srcs[k[0]];
      if (st && st.ok === false) {
        line.appendChild(h("span", { class: "pill pill--warn", title: (st.errors || []).slice(0, 3).join("\n") || null, text: t("src_fail", { s: t(k[1]) }) }));
      }
    });
    if (!SNAPSHOT) line.appendChild(h("span", { text: t("next_check") }));

    var banner = $("sample-banner");
    if (SNAPSHOT) {
      banner.textContent = "";
      banner.appendChild(h("span", { class: "banner__tag", text: t("snapshot") }));
      banner.appendChild(h("span", { text: t("snapshot_banner", { d: day(SNAPSHOT) }) + " " }));
      banner.appendChild(h("a", { href: location.pathname, text: t("snapshot_back") }));
    }
  }
  function num(n) { return typeof n === "number" ? String(n) : "0"; }

  /* ---------- graph ---------- */
  var G = {};

  function setupGraph() {
    var svg = d3.select("#graph-svg");
    G.svg = svg;
    G.layer = svg.append("g").attr("class", "layer");
    G.edgeLayer = G.layer.append("g").attr("class", "edges");
    G.nodeLayer = G.layer.append("g").attr("class", "nodes");
    G.nodes = new Map();
    G.zoom = d3.zoom().scaleExtent([0.15, 6]).on("zoom", function (ev) {
      G.layer.attr("transform", ev.transform);
      var k = ev.transform.k;
      G.k = k;
      svg.classed("zin", k >= Math.min(1.6, Math.max(1.2, (G.fitK || 1) * 1.5)));
      /* keep labels readable on screen when zoomed out (phones), without ballooning when zoomed in */
      svg.style("--ls", Math.max(1, Math.min(1.9, 1 / Math.pow(k, 0.8))).toFixed(3));
      clearTimeout(G.lblTimer);
      G.lblTimer = setTimeout(declutterLabels, 120);
    });
    svg.call(G.zoom).on("dblclick.zoom", null);
    svg.on("click", function (ev) {
      if (ev.target === svg.node()) select(null);
    });
    G.k = 1;
    G.width = $("graph-view").clientWidth || 800;
    G.height = $("graph-view").clientHeight || 600;
    G.sim = d3.forceSimulation()
      .alphaDecay(0.035)
      .velocityDecay(0.38)
      .on("tick", drawPositions)
      .on("end", declutterLabels);
    G.sim.stop();
    G.tip = $("tooltip");
  }

  function anchorFor(group) {
    var i = GROUP_RING.indexOf(group);
    if (i < 0) i = GROUP_RING.length - 1;
    var ang = (i / GROUP_RING.length) * Math.PI * 2 - Math.PI / 2;
    var portrait = G.height > G.width * 1.1;
    var rx = G.width * (portrait ? 0.3 : 0.4), ry = G.height * (portrait ? 0.4 : 0.36);
    return { x: G.width / 2 + Math.cos(ang) * rx, y: G.height / 2 + Math.sin(ang) * ry };
  }

  function widthScale(a) {
    if (!a) return 1.2;
    var v = (Math.log10(a) - 8) / (Math.log10(3e11) - 8);
    return 1.2 + Math.max(0, Math.min(1, v)) * 6;
  }

  function renderGraph(first, langOnly) {
    var gv = $("graph-view");
    if (first || !G.width) { G.width = gv.clientWidth || 800; G.height = gv.clientHeight || 600; }
    var maxTotal = 0;
    state.exposure.forEach(function (x) { if (x.total > maxTotal) maxTotal = x.total; });
    var sc = Math.max(0.42, Math.min(1, G.width / 900));
    var portrait = G.height > G.width * 1.1;
    G.sc = sc;
    var rScale = d3.scaleSqrt().domain([0, maxTotal || 1]).range([6, G.width < 600 ? 24 : 32]);

    /* nodes: reuse simulation objects so positions survive refreshes */
    var nodes = state.visibleNodes.map(function (id) {
      var n = G.nodes.get(id);
      var ent = state.ents.get(id);
      if (!n) {
        var a = anchorFor(ent.group);
        n = { id: id, x: a.x + (Math.random() - 0.5) * 60, y: a.y + (Math.random() - 0.5) * 60 };
        G.nodes.set(id, n);
      }
      n.ent = ent;
      n.exp = state.exposure.get(id);
      n.r = rScale(n.exp.total);
      return n;
    });
    var nodeIndex = new Map(nodes.map(function (n) { return [n.id, n]; }));

    /* one drawn line per (from, to, kind): several deals of the same type between the same two companies
       (e.g. three bond sales) become one thicker line whose width is their total; different types or
       opposite directions between the same pair bow apart */
    var bundles = new Map();
    state.visible.forEach(function (e) {
      var bk = bundleKey(e);
      if (!bundles.has(bk)) bundles.set(bk, []);
      bundles.get(bk).push(e);
    });
    var pairs = new Map();
    var links = [];
    G.linkOfEdge = new Map();
    bundles.forEach(function (arr, bk) {
      arr.sort(function (a, b) { return (b.amount_usd || 0) - (a.amount_usd || 0); });
      var e = arr[0];
      var amt = arr.reduce(function (sum, x) { return sum + (x.amount_usd || 0); }, 0) || null;
      var key = e.from < e.to ? e.from + "|" + e.to : e.to + "|" + e.from;
      var l = {
        id: arr.length === 1 ? e.id : "b:" + bk, bk: bk, e: e, edges: arr, amount: amt, from: e.from, to: e.to, kind: e.kind,
        source: nodeIndex.get(e.from), target: nodeIndex.get(e.to), key: key, w: widthScale(amt)
      };
      arr.forEach(function (x) { G.linkOfEdge.set(x.id, l); });
      if (!pairs.has(key)) pairs.set(key, []);
      pairs.get(key).push(l);
      links.push(l);
    });
    pairs.forEach(function (arr) {
      arr.sort(function (a, b) { return (b.amount || 0) - (a.amount || 0); });
      var k = arr.length;
      arr.forEach(function (l, i) {
        l.offset = k === 1 ? 0 : (i - (k - 1) / 2) * 16;
        l.canonFlip = l.from > l.to;
      });
    });
    /* thick first, thin on top */
    links.sort(function (a, b) { return b.w - a.w; });
    G.links = links;
    G.nodeList = nodes;

    var forceLinks = [];
    pairs.forEach(function (arr, key) {
      var p = key.split("|");
      forceLinks.push({ source: p[0], target: p[1], n: arr.length });
    });

    G.sim.nodes(nodes);
    G.sim
      .force("link", d3.forceLink(forceLinks).id(function (d) { return d.id; })
        .distance(function (l) { return 70 * sc + l.source.r + l.target.r; })
        .strength(function (l) { return 0.5 / Math.min(l.source.exp.deals, l.target.exp.deals); }))
      .force("charge", d3.forceManyBody().strength(function (d) { return (-200 - d.r * 9) * sc; }).distanceMax(420 * sc))
      .force("collide", d3.forceCollide().radius(function (d) { return d.r + 14 * sc; }).iterations(2))
      .force("x", d3.forceX(function (d) { return anchorFor(d.ent.group).x; }).strength(function (d) { return (portrait ? 0.16 : 0.07) * (d.exp.deals <= 1 ? 1.8 : 1); }))
      .force("y", d3.forceY(function (d) { return anchorFor(d.ent.group).y; }).strength(function (d) { return (portrait ? 0.06 : 0.08) * (d.exp.deals <= 1 ? 1.8 : 1); }));

    drawEdges();
    drawNodes();
    $("graph-empty").hidden = nodes.length > 0;
    renderLegendGroups();

    if (langOnly) { drawPositions(); renderSelection(); declutterLabels(); return; }
    if (first) {
      G.sim.alpha(1);
      for (var i = 0; i < 320; i++) G.sim.tick();
      drawPositions();
      fitView(false);
      G.sim.alpha(0).restart();
      declutterLabels();
    } else {
      G.sim.alpha(0.45).restart();
    }
    renderSelection();
  }

  function drawEdges() {
    var sel = G.edgeLayer.selectAll("g.edge-g").data(G.links, function (l) { return l.id; });
    sel.exit().remove();
    var enter = sel.enter().append("g").attr("class", "edge-g");
    enter.append("path").attr("class", "new-halo");
    enter.append("path").attr("class", "edge");
    enter.append("path").attr("class", "arrow");
    enter.append("path").attr("class", "edge-hit")
      .on("pointerenter pointermove", function (ev, l) { state.hover = linkSel(l); showLinkTip(ev, l); renderSelection(); })
      .on("pointerleave", function () { state.hover = null; hideTip(); renderSelection(); })
      .on("click", function (ev, l) { ev.stopPropagation(); hideTip(); select(linkSel(l), { reveal: true }); });
    var all = enter.merge(sel);
    all.order();
    all.each(function (l) {
      var g = d3.select(this);
      var isNew = l.edges.some(function (x) { return state.newIds.has(x.id); });
      var cand = l.edges.every(function (x) { return x.origin === "candidate"; });
      var color = kindColor(l.kind);
      g.select(".edge")
        .attr("class", "edge" + (cand ? " edge--candidate" : "") + (isNew ? " edge--new" : ""))
        .style("stroke", color).style("stroke-width", l.w + "px");
      g.select(".arrow").style("fill", color);
      g.select(".new-halo").style("display", isNew ? null : "none").style("stroke-width", (l.w + 7) + "px");
    });
    G.edgeSel = all;
  }

  function drawNodes() {
    var sel = G.nodeLayer.selectAll("g.node").data(G.nodeList, function (d) { return d.id; });
    sel.exit().remove();
    var enter = sel.enter().append("g").attr("class", "node").attr("tabindex", 0).attr("role", "button");
    enter.append("circle").attr("class", "node__ring");
    enter.append("circle").attr("class", "node__c");
    enter.append("text").attr("class", "node__label").attr("text-anchor", "middle");
    enter
      .on("pointerenter", function (ev, d) { state.hover = { type: "node", id: d.id }; showNodeTip(ev, d); renderSelection(); })
      .on("pointermove", function (ev, d) { showNodeTip(ev, d); })
      .on("pointerleave", function () { state.hover = null; hideTip(); renderSelection(); })
      .on("click", function (ev, d) { ev.stopPropagation(); hideTip(); select({ type: "node", id: d.id }, { reveal: true }); })
      .on("keydown", function (ev, d) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select({ type: "node", id: d.id }); }
      })
      .on("focus", function (ev, d) { state.hover = { type: "node", id: d.id }; renderSelection(); })
      .on("blur", function () { state.hover = null; renderSelection(); })
      .call(d3.drag().clickDistance(4)
        .on("start", function (ev, d) { if (!ev.active) G.sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; hideTip(); })
        .on("drag", function (ev, d) { d.fx = ev.x; d.fy = ev.y; })
        .on("end", function (ev, d) { if (!ev.active) G.sim.alphaTarget(0); d.fx = null; d.fy = null; }));
    var all = enter.merge(sel);
    var big = d3.quantile(G.nodeList.map(function (n) { return n.r; }).sort(d3.ascending), 0.55) || 10;
    all.each(function (d) {
      var g = d3.select(this);
      var c = groupColor(d.ent.group);
      g.attr("aria-label", entName(d.id) + ", " + I.group(state.lang, d.ent.group) + ", " + usd(d.exp.total));
      g.select(".node__c").attr("r", d.r)
        .style("fill", "color-mix(in srgb, " + c + " 22%, var(--surface))").style("stroke", c);
      g.select(".node__ring").attr("r", d.r + 4);
      var lbl = g.select(".node__label").attr("y", d.r + 13)
        .classed("node__label--big", d.r >= big).classed("node__label--small", d.r < big)
        .text(shortName(d.id));
      if (lbl.select("title").empty()) lbl.append("title");
      lbl.select("title").text(entName(d.id));
    });
    G.nodeSel = all;
  }

  function edgeGeometry(l) {
    var s = l.source, tg = l.target;
    var dx = tg.x - s.x, dy = tg.y - s.y;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    /* normal from the canonical (sorted id) direction, so A->B and B->A bow apart */
    var nx = -dy / dist, ny = dx / dist;
    if (l.canonFlip) { nx = -nx; ny = -ny; }
    var off = l.offset * 2;
    var cx = (s.x + tg.x) / 2 + nx * off, cy = (s.y + tg.y) / 2 + ny * off;
    var sdx = cx - s.x, sdy = cy - s.y, sl = Math.sqrt(sdx * sdx + sdy * sdy) || 1;
    var edx = tg.x - cx, edy = tg.y - cy, el = Math.sqrt(edx * edx + edy * edy) || 1;
    var ux = edx / el, uy = edy / el;
    var head = 5 + l.w * 1.3;
    var x1 = s.x + (sdx / sl) * (s.r + 2), y1 = s.y + (sdy / sl) * (s.r + 2);
    var tipX = tg.x - ux * (tg.r + 3), tipY = tg.y - uy * (tg.r + 3);
    var x2 = tipX - ux * head * 0.85, y2 = tipY - uy * head * 0.85;
    var line = Math.abs(off) < 0.5
      ? "M" + x1 + "," + y1 + "L" + x2 + "," + y2
      : "M" + x1 + "," + y1 + "Q" + cx + "," + cy + " " + x2 + "," + y2;
    var bx = tipX - ux * head, by = tipY - uy * head;
    var hw = head * 0.55;
    var arrow = "M" + tipX + "," + tipY + "L" + (bx - uy * hw) + "," + (by + ux * hw) + "L" + (bx + uy * hw) + "," + (by - ux * hw) + "Z";
    return { line: line, arrow: arrow };
  }

  function drawPositions() {
    if (!G.edgeSel) return;
    G.edgeSel.each(function (l) {
      var geo = edgeGeometry(l);
      var g = d3.select(this);
      g.select(".edge").attr("d", geo.line);
      g.select(".new-halo").attr("d", geo.line);
      g.select(".edge-hit").attr("d", geo.line);
      g.select(".arrow").attr("d", geo.arrow);
    });
    G.nodeSel.attr("transform", function (d) { return "translate(" + d.x + "," + d.y + ")"; });
  }

  function fitView(animate) {
    if (!G.nodeList || !G.nodeList.length) return;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    G.nodeList.forEach(function (n) {
      x0 = Math.min(x0, n.x - n.r - 40); x1 = Math.max(x1, n.x + n.r + 40);
      y0 = Math.min(y0, n.y - n.r - 10); y1 = Math.max(y1, n.y + n.r + 26);
    });
    var w = $("graph-view").clientWidth || G.width, hgt = $("graph-view").clientHeight || G.height;
    var k = Math.min(1.7, 0.96 * Math.min(w / (x1 - x0), hgt / (y1 - y0)));
    G.fitK = k;
    var tr = d3.zoomIdentity.translate(w / 2 - k * (x0 + x1) / 2, hgt / 2 - k * (y0 + y1) / 2).scale(k);
    (animate ? G.svg.transition().duration(400) : G.svg).call(G.zoom.transform, tr);
  }

  /* highlight = hover if any, else selection */
  function renderSelection() {
    if (!G.nodeSel) return;
    var focus = state.hover || state.sel;
    var nodesOn = null, edgesOn = null;
    if (focus && focus.type === "node") {
      nodesOn = new Set([focus.id]); edgesOn = new Set();
      G.links.forEach(function (l) {
        if (l.from === focus.id || l.to === focus.id) { edgesOn.add(l.id); nodesOn.add(l.from); nodesOn.add(l.to); }
      });
    } else if (focus) {
      var fl = focusLink(focus);
      if (fl) { nodesOn = new Set([fl.from, fl.to]); edgesOn = new Set([fl.id]); }
    }
    var selLink = state.sel && state.sel.type !== "node" ? focusLink(state.sel) : null;
    G.nodeSel
      .classed("is-dim", function (d) { return nodesOn ? !nodesOn.has(d.id) : false; })
      .classed("is-nbr", function (d) { return nodesOn ? nodesOn.has(d.id) : false; })
      .classed("is-sel", function (d) { return !!(state.sel && state.sel.type === "node" && state.sel.id === d.id); });
    G.edgeSel
      .classed("is-dim", function (l) { return edgesOn ? !edgesOn.has(l.id) : false; })
      .classed("is-hot", function (l) { return edgesOn ? edgesOn.has(l.id) : false; })
      .classed("is-sel", function (l) { return !!selLink && selLink.id === l.id; });
  }

  function linkSel(l) { return l.edges.length === 1 ? { type: "edge", id: l.e.id } : { type: "bundle", id: l.bk }; }
  function focusLink(f) {
    if (!f || !G.links) return null;
    if (f.type === "edge") return G.linkOfEdge && G.linkOfEdge.get(f.id) || null;
    if (f.type === "bundle") return G.links.filter(function (l) { return l.bk === f.id; })[0] || null;
    return null;
  }

  /* show as many labels as fit: biggest nodes first; each label tries below, above, right and left of its
     circle and is hidden only when all four would overlap a label already shown or a bigger circle */
  function declutterLabels() {
    if (!G.nodeSel) return;
    var k = G.k || 1, pad = 2.5 / k;
    var items = [];
    G.nodeSel.each(function (d) {
      var t = this.querySelector(".node__label");
      if (!t) return;
      t.classList.remove("is-hidden");
      t.setAttribute("x", 0); t.setAttribute("y", d.r + 13); t.setAttribute("text-anchor", "middle");
      var b;
      try { b = t.getBBox(); } catch (e) { return; }
      items.push({ el: t, d: d, w: b.width, h: b.height, asc: (d.r + 13) - b.y });
    });
    items.sort(function (a, b) { return b.d.r - a.d.r; });
    var placed = [];
    var circles = G.nodeList.map(function (n) { return { x: n.x, y: n.y, r: n.r, id: n.id }; });
    function free(it, x0, y0) {
      var x1 = x0 + it.w, y1 = y0 + it.h;
      x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
      if (placed.some(function (p) { return x0 < p.x1 && x1 > p.x0 && y0 < p.y1 && y1 > p.y0; })) return null;
      var hit = circles.some(function (c) {
        if (c.id === it.d.id || c.r < it.d.r * 0.6) return false;
        var cx = Math.max(x0, Math.min(c.x, x1)), cy = Math.max(y0, Math.min(c.y, y1));
        return (cx - c.x) * (cx - c.x) + (cy - c.y) * (cy - c.y) < c.r * c.r;
      });
      return hit ? null : { x0: x0, y0: y0, x1: x1, y1: y1 };
    }
    items.forEach(function (it) {
      var d = it.d, r = d.r, gap = 4;
      var opts = [
        { x: 0, y: r + 13, a: "middle", bx: d.x - it.w / 2, by: d.y + r + 13 - it.asc },
        { x: 0, y: -(r + gap + it.h - it.asc), a: "middle", bx: d.x - it.w / 2, by: d.y - r - gap - it.h },
        { x: r + gap, y: it.asc - it.h / 2, a: "start", bx: d.x + r + gap, by: d.y - it.h / 2 },
        { x: -(r + gap), y: it.asc - it.h / 2, a: "end", bx: d.x - r - gap - it.w, by: d.y - it.h / 2 }
      ];
      for (var i = 0; i < opts.length; i++) {
        var box = free(it, opts[i].bx, opts[i].by);
        if (box) {
          it.el.setAttribute("x", opts[i].x); it.el.setAttribute("y", opts[i].y); it.el.setAttribute("text-anchor", opts[i].a);
          placed.push(box);
          return;
        }
      }
      it.el.classList.add("is-hidden");
    });
  }

  function placeTip(ev) {
    var box = $("graph-view").getBoundingClientRect();
    var tip = G.tip;
    var x = ev.clientX - box.left + 14, y = ev.clientY - box.top + 14;
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    if (x + tw > box.width - 8) x = Math.max(8, ev.clientX - box.left - tw - 14);
    if (y + th > box.height - 8) y = Math.max(8, ev.clientY - box.top - th - 14);
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  function showNodeTip(ev, d) {
    if (ev.pointerType === "touch") return;
    var tip = G.tip;
    tip.textContent = "";
    tip.appendChild(h("span", { class: "tooltip__v", text: usd(d.exp.total) }));
    tip.appendChild(h("span", { class: "tooltip__t", text: entName(d.id) + (d.ent.ticker ? " · " + d.ent.ticker : "") }));
    tip.appendChild(h("span", { class: "tooltip__m" }, [
      h("span", { class: "dot", style: "--c:" + groupColor(d.ent.group) }), I.group(state.lang, d.ent.group) + " · " + d.exp.deals + " " + t("p_deals").toLowerCase()
    ]));
    tip.appendChild(h("span", { class: "tooltip__m", text: t("p_total_in") + " " + usd(d.exp.inflow, true) + " · " + t("p_total_out") + " " + usd(d.exp.outflow, true) }));
    tip.hidden = false;
    placeTip(ev);
  }
  function showEdgeTip(ev, e) {
    if (ev.pointerType === "touch") return;
    var tip = G.tip;
    tip.textContent = "";
    tip.appendChild(h("span", { class: "tooltip__v", text: usd(e.amount_usd) }));
    tip.appendChild(h("span", { class: "tooltip__t", text: edgeTitle(e) }));
    tip.appendChild(h("span", { class: "tooltip__m" }, [
      h("span", { class: "key", style: "--c:" + kindColor(e.kind) }),
      I.kind(state.lang, e.kind) + " · " + entName(e.from) + " → " + entName(e.to)
    ]));
    tip.appendChild(h("span", { class: "tooltip__m", text: day(e.announced) + " · " + I.status(state.lang, e.status) + " · " + I.confidence(state.lang, e.confidence) }));
    tip.hidden = false;
    placeTip(ev);
  }
  function showLinkTip(ev, l) {
    if (l.edges.length === 1) return showEdgeTip(ev, l.e);
    if (ev.pointerType === "touch") return;
    var tip = G.tip;
    tip.textContent = "";
    tip.appendChild(h("span", { class: "tooltip__v", text: usd(l.amount) }));
    tip.appendChild(h("span", { class: "tooltip__t", text: t("p_bundle", { n: l.edges.length }) + " · " + entName(l.from) + " → " + entName(l.to) }));
    tip.appendChild(h("span", { class: "tooltip__m" }, [h("span", { class: "key", style: "--c:" + kindColor(l.kind) }), I.kind(state.lang, l.kind)]));
    l.edges.slice(0, 4).forEach(function (e) {
      tip.appendChild(h("span", { class: "tooltip__m", text: usd(e.amount_usd, true) + " · " + edgeTitle(e) }));
    });
    if (l.edges.length > 4) tip.appendChild(h("span", { class: "tooltip__m", text: "+" + (l.edges.length - 4) }));
    tip.hidden = false;
    placeTip(ev);
  }
  function hideTip() { if (G.tip) G.tip.hidden = true; }

  function renderLegendGroups() {
    var present = new Set(G.nodeList.map(function (n) { return n.ent.group; }));
    var box = $("legend-groups");
    box.textContent = "";
    GROUP_ORDER.forEach(function (g) {
      if (!present.has(g)) return;
      box.appendChild(h("span", {}, [h("span", { class: "dot", style: "--c:" + groupColor(g), "aria-hidden": "true" }), I.group(state.lang, g)]));
    });
  }

  /* ---------- side panel ---------- */
  function statusEl(s) { return h("span", { class: "st st--" + (s || "na"), text: I.status(state.lang, s) }); }
  function confEl(c) { return h("span", { class: "cf cf--" + (c || "na"), text: I.confidence(state.lang, c) }); }
  function sourcesEl(e) {
    return h("span", { class: "srcs" }, e.sources.slice(0, 4).map(function (s) {
      return extLink(s.url, s.publisher || hostOf(s.url) || "source");
    }));
  }
  function entButton(id, cls) {
    var ent = state.ents.get(id);
    return h("button", {
      type: "button", class: cls || "prow__who", title: t("p_select_from", { name: entName(id) }),
      onclick: function () { select({ type: "node", id: id }); }
    }, [h("span", { class: "dot", style: "--c:" + groupColor(ent ? ent.group : "other"), "aria-hidden": "true" }), h("span", { text: entName(id) })]);
  }

  function renderPanel() {
    var p = $("panel");
    p.textContent = "";
    if (!state.raw) return;
    var sel = state.sel;
    if (sel && sel.type === "node" && state.ents.has(sel.id)) return renderNodePanel(p, sel.id);
    if (sel && sel.type === "edge" && state.edgeById.has(sel.id)) return renderEdgePanel(p, state.edgeById.get(sel.id));
    if (sel && sel.type === "bundle") {
      var be = bundleEdges(sel.id);
      if (be.length) return renderBundlePanel(p, be);
    }
    renderOverview(p);
  }

  function closeBtn() {
    return h("button", { type: "button", class: "icon-btn panel__close", "aria-label": t("panel_close"), title: t("panel_close"), onclick: function () { select(null); } }, ["×"]);
  }

  function renderOverview(p) {
    p.appendChild(h("div", { class: "panel__head" }, [
      h("div", { class: "panel__head-main" }, [h("h2", { class: "panel__title", text: t("panel_overview") })])
    ]));
    var body = h("div", { class: "panel__body" });
    body.appendChild(h("p", { class: "panel__hint", text: t("panel_overview_hint") }));
    var rows = Array.from(state.exposure.entries()).sort(function (a, b) { return b[1].total - a[1].total; }).slice(0, 12);
    var max = rows.length ? rows[0][1].total || 1 : 1;
    var ol = h("ol", { class: "ov-list" });
    rows.forEach(function (r, i) {
      var id = r[0], x = r[1], ent = state.ents.get(id);
      var bar = h("span", { class: "ov-bar", "aria-hidden": "true" });
      KIND_ORDER.forEach(function (k) {
        var v = x.byKind[k];
        if (v) bar.appendChild(h("i", { style: "--c:" + kindColor(k) + ";width:" + (v / max * 100).toFixed(2) + "%" }));
      });
      ol.appendChild(h("li", {}, [h("button", { type: "button", class: "ov-btn", onclick: function () { select({ type: "node", id: id }); } }, [
        h("span", { class: "ov-rank", text: String(i + 1) }),
        h("span", { class: "ov-name" }, [h("span", { class: "dot", style: "--c:" + groupColor(ent.group), "aria-hidden": "true" }), h("span", { text: entName(id) })]),
        h("span", { class: "ov-amt", text: usd(x.total, true) }),
        bar
      ])]));
    });
    body.appendChild(ol);
    p.appendChild(body);
  }

  function renderNodePanel(p, id) {
    var ent = state.ents.get(id);
    var x = state.exposure.get(id) || { inflow: 0, outflow: 0, deals: 0 };
    var meta = [ent.ticker, ent.country].filter(Boolean).join(" · ");
    p.appendChild(h("div", { class: "panel__head" }, [
      h("div", { class: "panel__head-main" }, [
        h("div", { class: "panel__eyebrow" }, [h("span", { class: "dot", style: "--c:" + groupColor(ent.group) }), I.group(state.lang, ent.group)]),
        h("h2", { class: "panel__title", text: entName(id) }),
        meta ? h("div", { class: "panel__meta", text: meta }) : null
      ]),
      closeBtn()
    ]));
    var body = h("div", { class: "panel__body" });
    body.appendChild(h("div", { class: "panel__totals" }, [
      h("div", {}, [h("span", { text: t("p_total_in") }), h("b", { text: usd(x.inflow, true) })]),
      h("div", {}, [h("span", { text: t("p_total_out") }), h("b", { text: usd(x.outflow, true) })]),
      h("div", {}, [h("span", { text: t("p_deals") }), h("b", { text: String(x.deals) })])
    ]));

    /* direction rule: debt from=lender to=borrower; order from=buyer; investment from=investor; lease from=lessee */
    var sections = [
      ["p_owes", "debt", "to"], ["p_owed", "debt", "from"],
      ["p_orders_placed", "order", "from"], ["p_orders_received", "order", "to"],
      ["p_invest_made", "investment", "from"], ["p_invest_received", "investment", "to"],
      ["p_leases_paid", "lease", "from"], ["p_leases_received", "lease", "to"],
      ["p_vf_given", "vendor_financing", "from"], ["p_vf_received", "vendor_financing", "to"],
      ["p_guar_given", "guarantee", "from"], ["p_guar_received", "guarantee", "to"]
    ];
    var any = false;
    sections.forEach(function (s) {
      var rows = state.visible.filter(function (e) { return e.kind === s[1] && e[s[2]] === id; })
        .sort(function (a, b) { return (b.amount_usd || 0) - (a.amount_usd || 0); });
      if (!rows.length) return;
      any = true;
      var total = rows.reduce(function (a, e) { return a + (e.amount_usd || 0); }, 0);
      var list = h("ul", { class: "plist" });
      rows.forEach(function (e) {
        var other = s[2] === "from" ? e.to : e.from;
        list.appendChild(dealRow(e, other));
      });
      body.appendChild(h("section", { class: "psec" }, [
        h("h4", {}, [h("span", { class: "key", style: "--c:" + kindColor(s[1]), "aria-hidden": "true" }), t(s[0]), h("span", { class: "chip__n", text: usd(total, true) })]),
        list
      ]));
    });
    if (!any) body.appendChild(h("p", { class: "panel__hint", text: t("p_none") }));
    p.appendChild(body);
  }

  function dealRow(e, other) {
    return h("li", { class: "prow" }, [
      entButton(other),
      h("span", { class: "prow__amt", text: usd(e.amount_usd, true) }),
      h("span", { class: "prow__t" }, [h("button", { type: "button", onclick: function () { select({ type: "edge", id: e.id }); }, text: edgeTitle(e) })]),
      h("span", { class: "prow__m" }, [
        state.newIds.has(e.id) ? h("span", { class: "newtag", text: t("p_new") }) : null,
        h("span", { class: "d", text: day(e.announced) }), statusEl(e.status), confEl(e.confidence), sourcesEl(e)
      ])
    ]);
  }

  function renderBundlePanel(p, list) {
    var e0 = list[0];
    var total = list.reduce(function (a, e) { return a + (e.amount_usd || 0); }, 0);
    p.appendChild(h("div", { class: "panel__head" }, [
      h("div", { class: "panel__head-main" }, [
        h("div", { class: "panel__eyebrow" }, [h("span", { class: "key", style: "--c:" + kindColor(e0.kind) }), I.kind(state.lang, e0.kind)]),
        h("h2", { class: "panel__title", text: entName(e0.from) + " → " + entName(e0.to) }),
        h("div", { class: "panel__meta", text: t("p_bundle", { n: list.length }) })
      ]),
      closeBtn()
    ]));
    var body = h("div", { class: "panel__body" });
    body.appendChild(h("div", { class: "deal-amt", text: usd(total || null) }));
    body.appendChild(h("p", { class: "panel__hint", text: t("p_bundle_hint") }));
    var ul = h("ul", { class: "plist" });
    list.forEach(function (e) { ul.appendChild(dealRow(e, e.from === e0.from ? e.to : e.from)); });
    body.appendChild(ul);
    p.appendChild(body);
  }

  function renderEdgePanel(p, e) {
    p.appendChild(h("div", { class: "panel__head" }, [
      h("div", { class: "panel__head-main" }, [
        h("div", { class: "panel__eyebrow" }, [
          h("span", { class: "key", style: "--c:" + kindColor(e.kind) }), I.kind(state.lang, e.kind),
          state.newIds.has(e.id) ? h("span", { class: "newtag", text: t("p_new") }) : null
        ]),
        h("h2", { class: "panel__title", text: edgeTitle(e) })
      ]),
      closeBtn()
    ]));
    var body = h("div", { class: "panel__body" });
    body.appendChild(h("div", {}, [
      h("div", { class: "deal-amt", text: usd(e.amount_usd) }),
      e.amount_text ? h("p", { class: "deal-note", lang: "en", text: (state.lang === "zh" ? t("p_amount_note") + "：" : "") + e.amount_text }) : null
    ]));
    body.appendChild(h("div", { class: "deal-flow", "aria-label": t("p_flow") }, [
      entButton(e.from), h("span", { class: "arrowtxt", "aria-hidden": "true", text: "→" }), entButton(e.to)
    ]));
    if (e.origin === "candidate") body.appendChild(h("p", { class: "callout", text: t("p_origin_candidate") }));
    var sum = edgeSummary(e);
    if (sum) body.appendChild(h("p", { class: "deal-summary", text: sum }));
    var kv = h("dl", { class: "kv" });
    function row(k, v) { if (v) { kv.appendChild(h("dt", { text: k })); kv.appendChild(h("dd", {}, [v])); } }
    row(t("t_status"), statusEl(e.status));
    row(t("t_confidence"), confEl(e.confidence));
    row(t("p_announced"), e.announced ? day(e.announced) : null);
    row(t("p_subkind"), e.subkind || null);
    row(t("p_term"), e.term || null);
    body.appendChild(kv);
    if (e.sources.length) {
      body.appendChild(h("section", { class: "psec" }, [
        h("h4", { text: t("p_sources") }),
        h("ul", { class: "srclist" }, e.sources.map(function (s) {
          return h("li", {}, [
            extLink(s.url, s.title || s.url),
            h("span", { class: "pub", text: [s.publisher || hostOf(s.url), s.date ? day(s.date) : null].filter(Boolean).join(" · ") })
          ]);
        }))
      ]));
    }
    p.appendChild(body);
  }

  /* ---------- table ---------- */
  var COLS = [
    { key: "date", label: "t_date", get: function (e) { return e.announced || ""; } },
    { key: "kind", label: "t_kind", get: function (e) { return KIND_ORDER.indexOf(e.kind); } },
    { key: "from", label: "t_from", get: function (e) { return entName(e.from).toLowerCase(); } },
    { key: "to", label: "t_to", get: function (e) { return entName(e.to).toLowerCase(); } },
    { key: "deal", label: "t_deal", get: function (e) { return edgeTitle(e).toLowerCase(); } },
    { key: "amount", label: "t_amount", num: true, get: function (e) { return e.amount_usd == null ? -1 : e.amount_usd; } },
    { key: "status", label: "t_status", get: function (e) { return e.status || ""; } },
    { key: "confidence", label: "t_confidence", get: function (e) { return e.confidence || ""; } },
    { key: "sources", label: "t_sources", nosort: true }
  ];

  function sortedVisible() {
    var col = COLS.filter(function (c) { return c.key === state.sort.key; })[0] || COLS[0];
    var dir = state.sort.dir;
    return state.visible.slice().sort(function (a, b) {
      var x = col.get(a), y = col.get(b);
      if (x < y) return -dir;
      if (x > y) return dir;
      return (b.amount_usd || 0) - (a.amount_usd || 0);
    });
  }

  function renderTable() {
    var head = $("deals-head");
    head.textContent = "";
    COLS.forEach(function (c) {
      var active = state.sort.key === c.key;
      var th = h("th", { scope: "col", class: c.num ? "num" : null, "aria-sort": active ? (state.sort.dir > 0 ? "ascending" : "descending") : null });
      if (c.nosort) th.textContent = t(c.label);
      else th.appendChild(h("button", {
        type: "button", onclick: function () {
          if (state.sort.key === c.key) state.sort.dir = -state.sort.dir;
          else { state.sort.key = c.key; state.sort.dir = c.key === "date" || c.num ? -1 : 1; }
          renderTable();
        }
      }, [t(c.label), h("span", { class: "sort", "aria-hidden": "true", text: active ? (state.sort.dir > 0 ? "▲" : "▼") : "↕" })]));
      head.appendChild(th);
    });
    var body = $("deals-body");
    body.textContent = "";
    var frag = document.createDocumentFragment();
    sortedVisible().forEach(function (e) {
      var tr = h("tr", {
        class: (state.newIds.has(e.id) ? "is-new" : "") + (state.sel && state.sel.id === e.id ? " is-sel" : ""),
        onclick: function (ev) { if (ev.target.closest("a,button")) return; select({ type: "edge", id: e.id }, { reveal: true }); }
      }, [
        h("td", { class: "date", text: e.announced || "" }),
        h("td", {}, [h("span", { class: "kindtag" }, [h("span", { class: "key", style: "--c:" + kindColor(e.kind) }), I.kind(state.lang, e.kind)])]),
        h("td", { class: "who", text: entName(e.from) }),
        h("td", { class: "who", text: entName(e.to) }),
        h("td", { class: "title" }, [h("button", { type: "button", class: "prow__who", style: "font-weight:500", onclick: function () { select({ type: "edge", id: e.id }, { reveal: true }); }, text: edgeTitle(e) })]),
        h("td", { class: "num", text: usd(e.amount_usd, true) }),
        h("td", {}, [statusEl(e.status)]),
        h("td", {}, [confEl(e.confidence)]),
        h("td", { class: "src" }, [sourcesEl(e)])
      ]);
      frag.appendChild(tr);
    });
    body.appendChild(frag);
  }

  function csvCell(v) {
    var s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function downloadCSV() {
    var cols = ["id", "announced", "kind", "subkind", "from", "from_name", "to", "to_name", "amount_usd", "amount_text", "status", "confidence", "origin", "title_en", "title_zh", "sources"];
    var lines = [cols.join(",")];
    sortedVisible().forEach(function (e) {
      var a = state.ents.get(e.from), b = state.ents.get(e.to);
      var row = [e.id, e.announced, e.kind, e.subkind, e.from, state.lang === "zh" ? a.name_zh : a.name, e.to, state.lang === "zh" ? b.name_zh : b.name,
        e.amount_usd, e.amount_text, e.status, e.confidence, e.origin, e.title_en, e.title_zh,
        e.sources.map(function (s) { return s.url; }).join(" ")];
      lines.push(row.map(csvCell).join(","));
    });
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = h("a", { href: url, download: "ai-orders-debt-" + isoDay(new Date()) + ".csv" });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  /* ---------- latest feed ---------- */
  function sortByDate(arr, key) {
    return arr.slice().sort(function (a, b) {
      var x = I.parseISO(a[key]), y = I.parseISO(b[key]);
      return (y ? y.getTime() : 0) - (x ? x.getTime() : 0);
    });
  }
  function renderFeeds() {
    var raw = state.raw || {};
    var news = Array.isArray(raw.news) ? raw.news : [];
    var filings = Array.isArray(raw.filings) ? raw.filings : [];
    var nl = $("feed-news");
    nl.textContent = "";
    if (!news.length) nl.appendChild(h("li", { class: "feed__empty", text: t("latest_none_news") }));
    sortByDate(news, "published").slice(0, 10).forEach(function (n) {
      nl.appendChild(h("li", {}, [
        extLink(n.link, n.title || n.link),
        h("span", { class: "feed__m" }, [
          h("span", { class: "d", text: day(n.published) }),
          (n.publisher || n.source) ? h("span", { text: n.publisher || n.source }) : null
        ].concat((n.entities || []).filter(function (id) { return state.ents.has(id); }).slice(0, 5).map(function (id) {
          return h("button", { type: "button", class: "ent", text: entName(id), onclick: function () { select({ type: "node", id: id }, { reveal: true }); } });
        })))
      ]));
    });
    var fl = $("feed-filings");
    fl.textContent = "";
    if (!filings.length) fl.appendChild(h("li", { class: "feed__empty", text: t("latest_none_filings") }));
    sortByDate(filings, "filed").slice(0, 10).forEach(function (f) {
      var items = Array.isArray(f.items) ? f.items.join(", ") : (f.items || "");
      fl.appendChild(h("li", {}, [
        extLink(f.url || f.index_url, (state.lang === "zh" ? f.title_zh : f.title_en) || f.title_en || f.title || (entName(f.entity) + " " + (f.form || ""))),
        h("span", { class: "feed__m" }, [
          h("span", { class: "form-tag", text: f.form || "" }),
          items ? h("span", { text: t("filing_items", { items: items }) }) : null,
          h("span", { class: "d", text: day(f.filed) }),
          state.ents.has(f.entity) ? h("button", { type: "button", class: "ent", text: entName(f.entity), onclick: function () { select({ type: "node", id: f.entity }, { reveal: true }); } }) : null
        ])
      ]));
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    applyStatic();
    wireControls();
    setupGraph();
    setView("graph");
    load();
    if (!SNAPSHOT) setInterval(load, REFRESH_MS);
    window.AOD = { reload: load, state: state };
    setInterval(renderLive, 30 * 1000);
    var rt;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        var gv = $("graph-view");
        if (gv.clientWidth) { G.width = gv.clientWidth; G.height = gv.clientHeight; }
      }, 200);
    });
  }

  if (!window.d3) {
    document.addEventListener("DOMContentLoaded", function () { $("error-banner").hidden = false; });
    return;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
