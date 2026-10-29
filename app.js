/* AI Orders & Debt Map: live relationship graph of orders, investments and debt.
   Reads data/graph.json (published site) or ../data/graph.json (repo served locally, page at /site/).
   ?snapshot=YYYY-MM-DD reads data/archive/YYYY-MM-DD.json instead (no auto-refresh).
   Re-fetches every 5 minutes without losing zoom or selection. */
(function () {
  "use strict";

  var I = window.I18N;
  var KIND_ORDER = ["order", "investment", "debt", "vendor_financing", "lease", "guarantee"];
  /* four colour classes: the three small kinds share the slate "Other financing" */
  var KIND_CLASS = { order: "order", investment: "investment", debt: "debt", lease: "other", vendor_financing: "other", guarantee: "other" };
  var CLASSES = ["order", "investment", "debt", "other"];
  /* pooled counterparties: drawn as dashed hollow circles and never ranked */
  var POOL = ["bond-investors", "private-investors", "bank-lenders", "public-equity-investors"];
  var GROUP_ORDER = ["hyperscaler", "model_lab", "chip", "neocloud", "datacenter", "energy", "financier", "spv", "other"];
  /* ring order for the layout anchors: neighbours on the ring trade most with each other */
  var GROUP_RING = ["chip", "model_lab", "hyperscaler", "neocloud", "datacenter", "energy", "spv", "financier", "other"];
  var REFRESH_MS = 5 * 60 * 1000;
  var STALE_MS = 8 * 60 * 60 * 1000;  // runs every 3 hours; stale after two missed runs
  var DATA_PATHS = ["data/graph.json", "../data/graph.json"];
  var SNAPSHOT = (function () {
    var m = /[?&]snapshot=(\d{4}-\d{2}-\d{2})(?:&|$)/.exec(location.search);
    return m ? m[1] : null;
  })();
  var MIN_OPTIONS = [0, 1e9, 1e10, 5e10, 1e11];
  var PERIODS = [["all", "f_period_all"], ["365", "f_period_365"], ["90", "f_period_90"], ["2026", "f_period_2026"], ["2025", "f_period_2025"], ["custom", "f_period_custom"]];
  var SORTS = [["date", "sort_date", -1], ["amount", "sort_amount", -1], ["company", "sort_company", 1]];
  var VIEWS = ["graph", "table", "loops", "changes"];
  var LS_LANG = "aod.lang";
  var LS_SEEN = "aod.seenEdges";
  /* binding = the parties have signed (or are performing / have performed); announced and reported are not yet */
  var BINDING = ["signed", "in_progress", "completed"];
  var CHANGES_MAX = 100;
  var SITE_URL = "https://helajo.github.io/ai-orders-debt-live/";

  function mq(q) {
    try { return window.matchMedia(q); } catch (e) { return { matches: false }; }
  }
  var COARSE = mq("(pointer: coarse)").matches;
  var RM = mq("(prefers-reduced-motion: reduce)");
  function DUR(ms) { return RM.matches ? 0 : ms; }

  /* ---------- small helpers ---------- */
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  };
  /* a missing element (older markup) gets a detached stand-in so one gap never stops the page */
  var stand = {};
  function $(id) { return document.getElementById(id) || stand[id] || (stand[id] = document.createElement("div")); }
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
  var SVGNS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }
  function safeUrl(u) {
    return typeof u === "string" && /^https?:\/\//i.test(u) ? u : null;
  }
  /* the script a headline is written in: "zh" (Han), "ja" (kana), "ko" (Hangul) or "en" (anything else, Latin
     included); Han with kana is Japanese, Han alone is taken as Chinese */
  function scriptOf(s) {
    s = String(s || "");
    if (/[぀-ヿ]/.test(s)) return "ja";
    if (/[가-힯ㄱ-ㆎ]/.test(s)) return "ko";
    if (/[㐀-鿿]/.test(s)) return "zh";
    return "en";
  }
  function hasCJK(s) { return scriptOf(s) !== "en"; }
  /* links to outside pages; text not in the page language is marked with its own lang */
  function extLink(url, text, cls) {
    var u = safeUrl(url);
    var sc = scriptOf(text);
    var lang = sc === "zh" ? (state.lang === "zh" ? null : "zh-CN") : sc === "en" ? (state.lang === "en" ? null : "en") : sc;
    if (!u) return h("span", { class: cls, lang: lang, text: text });
    return h("a", { href: u, target: "_blank", rel: "noopener noreferrer", class: cls, lang: lang, text: text });
  }
  function hostOf(u) {
    try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
  }
  function isoDay(d) { return d.toISOString().slice(0, 10); }
  function kindColor(k) { return KIND_ORDER.indexOf(k) >= 0 ? "var(--k-" + k + ")" : "var(--muted)"; }
  function classOf(k) { return KIND_CLASS[k] || "other"; }
  function classColor(c) { return "var(--k-" + c + ")"; }
  function classKinds(c) { return KIND_ORDER.filter(function (k) { return classOf(k) === c; }); }
  function classLabel(c) { return c === "other" ? t("kind_other") : I.kind(state.lang, c); }
  function isPool(id) { return POOL.indexOf(id) >= 0; }

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
    newDismissed: false,
    lastNewCount: 0,
    filters: defaultFilters(),
    view: "graph",
    scope: "all",
    rankBy: "total",
    sel: null,
    hover: null,
    opener: null,
    lastInteract: 0,
    sort: { key: "date", dir: -1 },
    visible: [],
    visibleNodes: [],
    loops: [],          /* stats.circular (or the same shape computed here), unfiltered */
    visibleLoops: [],   /* loops whose every leg has a deal in the current filter */
    loopsOf: new Map(), /* entity id -> visible loops it is part of */
    timeline: [],       /* stats.timeline (or computed here) */
    changes: null,      /* data/changes.json: null until fetched, [] when missing */
    changesState: "loading"
  };

  function defaultFilters() {
    return { kinds: new Set(KIND_ORDER), group: "", min: 0, period: "all", from: "", to: "", q: "", onlyNew: false, confirmedOnly: false, bindingOnly: false };
  }
  function isBinding(e) { return BINDING.indexOf(e.status) >= 0; }

  function t(key, vars) { return I.t(state.lang, key, vars); }
  /* bare: drop 美元 where a column header already carries the unit (Chinese only) */
  function usd(n, bare) { return I.fmtUSD(n, state.lang, { bare: !!bare }); }
  /* a sum over deals: "$0" would be wrong when the deals exist but their amounts are undisclosed */
  function usdSum(n, deals, bare) {
    if (n > 0) return usd(n, bare);
    return deals > 0 ? t("undisclosed") : "–";
  }
  /* the amount a deal contributes to any total (tiles, node size, money in/out, rankings, line widths, table
     footer): nothing when it is cancelled, nothing for a guarantee. A guarantee is contingent (the guarantor pays
     only if the obligor fails) and the lease or loan it backs is already counted; build.py applies the same rule
     to stats.total_usd and the per-entity inflow/outflow, so the headline total here matches the data file. */
  function countedAmount(e) {
    if (!e || e.status === "cancelled" || e.kind === "guarantee") return 0;
    return e.amount_usd || 0;
  }
  /* a live guarantee's face amount, shown beside the totals as contingent exposure (stats.contingent_usd) */
  function contingentAmount(e) {
    return e && e.kind === "guarantee" && e.status !== "cancelled" ? (e.amount_usd || 0) : 0;
  }
  /* why a row's amount is not in the totals: "cancelled" or "contingent"; null for a counted deal */
  function notCountedKey(e) {
    if (!e) return null;
    if (e.status === "cancelled") return "cancelled";
    if (e.kind === "guarantee") return "contingent";
    return null;
  }
  /* a small tag next to an amount that is listed but not counted */
  function ctag(e) {
    var k = notCountedKey(e);
    return k ? h("span", { class: "ctag ctag--" + k, text: t(k), title: t("not_counted_" + k) }) : null;
  }
  /* an amount as a list or table row shows it: struck through when the deal is cancelled, a small "undisclosed"
     badge instead of a figure when none was disclosed */
  function amtEl(e, cls, bare) {
    var k = notCountedKey(e);
    if (e.amount_usd == null) return h("span", { class: cls + " is-undisclosed", title: t("not_counted_undisclosed") }, [undisclosedBadge()]);
    return h("span", { class: cls + (k === "cancelled" ? " is-cancelled" : ""), title: k ? t("not_counted_" + k) : null }, [usd(e.amount_usd, bare)]);
  }
  function undisclosedBadge() { return h("span", { class: "ctag ctag--undisclosed", text: t("undisclosed_badge") }); }
  function day(s) { return I.fmtDate(s, state.lang); }
  /* compact dates in lists: ISO in Chinese, "Sep 10, 2025" in English */
  function dayMeta(s) { return I.fmtDate(s, state.lang, state.lang === "zh" ? { iso: true } : null); }
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
  function optionLabel(id) {
    var e = state.ents.get(id);
    return entName(id) + (e && e.ticker ? " (" + e.ticker + ")" : "");
  }
  function bundleKey(e) { return e.from + "|" + e.to + "|" + e.kind; }
  function edgeTitle(e) { return (state.lang === "zh" ? e.title_zh : e.title_en) || e.title_en || e.title_zh || e.id; }
  /* lang attribute for an edge title shown in the Chinese page that fell back to English */
  function titleLang(e) { return state.lang === "zh" && !e.title_zh ? "en" : null; }
  function edgeSummary(e) { return (state.lang === "zh" ? e.summary_zh : e.summary_en) || e.summary_en || e.summary_zh || ""; }
  function srStatus(msg) { $("sr-status").textContent = msg; }
  function selName(sel) {
    if (!sel) return "";
    if (sel.type === "node") return entName(sel.id);
    if (sel.type === "edge") { var e = state.edgeById.get(sel.id); return e ? edgeTitle(e) : sel.id; }
    var p = sel.id.split("|");
    if (sel.type === "loop") return p.map(entName).join(" → ") + " → " + entName(p[0]);
    return entName(p[0]) + " → " + entName(p[1]);
  }
  function loopByKey(key) { return state.loops.filter(function (lp) { return lp.key === key; })[0] || null; }
  /* the drawn lines (one per from|to|kind bundle) that carry a loop's legs */
  function loopLinkIds(lp) {
    var ids = new Set();
    lp.legs.forEach(function (leg) {
      leg.edge_ids.forEach(function (id) { var l = G.linkOfEdge && G.linkOfEdge.get(id); if (l) ids.add(l.id); });
    });
    return ids;
  }
  /* a click on a button: keyboard activation (Enter/Space) reports detail 0 */
  function picker(sel) {
    return function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      select(sel, { kbd: !!ev && ev.detail === 0 });
    };
  }

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
      loadChanges(res.path);
    }, function () {
      state.fetchFailed = true;
      if (!state.raw) {
        /* a missing archive file is not a connection problem: say so and offer the live map */
        showError(SNAPSHOT ? "snapshot" : "load");
        $("graph-loading").hidden = true;
        console.warn("AOD: could not load data/graph.json; serve the repo root and open /site/, or check that data/graph.json exists");
      }
    }).then(function () {
      state.lastFetch = Date.now();
      live.removeAttribute("data-busy");
      renderLive();
    });
  }

  /* the error banner in one of three shapes: load (retry), snapshot (back to live), script (reload) */
  function showError(kind) {
    var b = $("error-banner");
    b.hidden = false;
    b.setAttribute("data-kind", kind);
    $("error-text").textContent = kind === "snapshot" ? t("snapshot_missing", { d: day(SNAPSHOT) }) : kind === "script" ? t("script_error") : t("load_error");
    $("error-back").hidden = kind !== "snapshot";
    $("retry").textContent = kind === "script" ? t("reload") : t("retry");
    $("retry").hidden = kind === "snapshot";
  }

  /* data/changes.json sits next to graph.json; a deployment without it just shows an empty Changes tab */
  function loadChanges(graphPath) {
    if (state.changesState === "ok" && !state.changesStale) return;
    var url = graphPath.replace(/archive\/\d{4}-\d{2}-\d{2}\.json$/, "graph.json").replace(/graph\.json$/, "changes.json");
    fetch(url + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(url + " " + r.status);
      return r.json();
    }).then(function (j) {
      var list = j && Array.isArray(j.changes) ? j.changes : [];
      state.changes = list.filter(function (c) { return c && typeof c === "object"; });
      state.changesState = "ok";
      state.changesStale = false;
    }, function () {
      if (state.changesState !== "ok") { state.changes = []; state.changesState = "missing"; }
    }).then(function () {
      if (state.view === "changes") renderChanges();
    });
  }

  function ingest(json, path, sample) {
    var stamp = (json.generated_at || "") + "|" + ((json.monitor && json.monitor.last_run) || "") + "|" + json.edges.length;
    var first = !state.raw;
    state.source = path;
    state.sample = sample;
    $("sample-banner").hidden = !SNAPSHOT;
    $("error-banner").hidden = true;
    $("graph-loading").hidden = true;
    if (!first && stamp === state.stamp && !sample) { state.raw = json; return; }
    if (state.stamp && stamp !== state.stamp) state.changesStale = true;
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
      /* unverified, machine-extracted candidates are never shown: the published graph.json
         no longer carries them, and any that do turn up are dropped here */
      if (e.origin === "candidate" || e.confidence === "unverified") return;
      e.origin = "curated";
      if (typeof e.amount_usd !== "number" || !isFinite(e.amount_usd) || e.amount_usd <= 0) e.amount_usd = null;
      if (!Array.isArray(e.sources)) e.sources = [];
      edges.push(e);
    });
    state.ents = ents;
    state.edges = edges;
    state.edgeById = new Map(edges.map(function (e) { return [e.id, e]; }));
    var stats = json.stats || {};
    /* loops and the monthly series come from build.py when it emits them; older files get the same shape computed here */
    state.loops = normalizeLoops(Array.isArray(stats.circular) ? stats.circular : computeLoops(edges));
    state.timeline = Array.isArray(stats.timeline) && stats.timeline.length ? stats.timeline : computeTimeline(edges);
    state.timelineNote = stats.timeline_note || null;

    /* "new" = not seen in the previous fetch this session, or (first load) since the last visit */
    var ids = new Set(edges.map(function (e) { return e.id; }));
    var before = state.newIds.size;
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
    /* deals that arrive after the bar was dismissed are new again */
    if (!first && state.newIds.size > before) state.newDismissed = false;
    state.prevIds = ids;

    if (state.sel) {
      var gone = state.sel.type === "node" ? !ents.has(state.sel.id)
        : state.sel.type === "bundle" ? !bundleEdges(state.sel.id, edges).length : !state.edgeById.has(state.sel.id);
      if (gone) state.sel = null;
    }
    if (first) {
      readHash();
      var gw = $("graph-view").clientWidth;
      if (gw && gw < 600) state.scope = 20;
      renderScopeButtons();
    }
    buildFilterControls();
    renderAll(first);
  }

  /* ---------- filtering ---------- */
  /* skip: "kinds" ignores the deal-type filter (for the mix bar) */
  function edgeVisible(e, skip) {
    var f = state.filters;
    if (f.onlyNew && !state.newIds.has(e.id)) return false;
    if (skip !== "kinds" && !f.kinds.has(e.kind)) return false;
    if (f.confirmedOnly && e.confidence !== "confirmed") return false;
    if (f.bindingOnly && !isBinding(e)) return false;
    if (f.min > 0 && !(e.amount_usd >= f.min)) return false;
    var d = e.announced || "";
    if (f.from && (!d || d < f.from)) return false;
    if (f.to && (!d || d > f.to)) return false;
    var a = state.ents.get(e.from), b = state.ents.get(e.to);
    if (f.group && a.group !== f.group && b.group !== f.group) return false;
    if (f.q) {
      var hay = [e.title_en, e.title_zh, e.subkind, e.subkind_zh, e.id, a.name, a.name_zh, a.ticker, a.id, b.name, b.name_zh, b.ticker, b.id]
        .join(" ").toLowerCase();
      if (hay.indexOf(f.q) < 0) return false;
    }
    return true;
  }

  function computeVisible() {
    state.visible = state.edges.filter(function (e) { return edgeVisible(e); });
    var exp = new Map();
    state.visible.forEach(function (e) {
      [e.from, e.to].forEach(function (id) {
        if (!exp.has(id)) {
          exp.set(id, { total: 0, inflow: 0, outflow: 0, deals: 0, inDeals: 0, outDeals: 0, cancelled: 0, guarIn: 0, guarOut: 0, nGuarIn: 0, nGuarOut: 0, byKind: {}, byKindIn: {}, byKindOut: {}, nIn: {}, nOut: {},
            cp: new Map(), confirmed: 0, reported: 0, binding: 0, nonBinding: 0, undisclosed: 0, lastEdge: "", lastSource: "" });
        }
      });
      /* cash totals: cancelled deals and guarantees contribute nothing; guarantees are kept separately as contingent */
      var a = countedAmount(e), g = contingentAmount(e), k = e.kind;
      var s = exp.get(e.from), r = exp.get(e.to);
      s.outflow += a; s.total += a; s.deals++; s.outDeals++; s.byKind[k] = (s.byKind[k] || 0) + a;
      s.byKindOut[k] = (s.byKindOut[k] || 0) + a; s.nOut[k] = (s.nOut[k] || 0) + 1;
      r.inflow += a; r.total += a; r.deals++; r.inDeals++; r.byKind[k] = (r.byKind[k] || 0) + a;
      r.byKindIn[k] = (r.byKindIn[k] || 0) + a; r.nIn[k] = (r.nIn[k] || 0) + 1;
      if (e.status === "cancelled") { s.cancelled++; r.cancelled++; }
      if (k === "guarantee") { s.guarOut += g; s.nGuarOut++; r.guarIn += g; r.nGuarIn++; }
      /* the panel's extras (graph.json carries the same figures unfiltered as per-entity stats): who the money is
         with, how sure we are of it, whether it is binding, and how fresh the record is */
      var lastSrc = e.sources.reduce(function (m, src) { return src && src.date && src.date > m ? src.date : m; }, "");
      [[s, e.to], [r, e.from]].forEach(function (p) {
        var x = p[0], other = p[1];
        var c = x.cp.get(other) || { usd: 0, n: 0 };
        c.usd += a; c.n++; x.cp.set(other, c);
        if (e.confidence === "confirmed") x.confirmed += a; else x.reported += a;
        if (isBinding(e)) x.binding += a; else if (e.status !== "cancelled") x.nonBinding += a;
        if (e.amount_usd == null) x.undisclosed++;
        if ((e.announced || "") > x.lastEdge) x.lastEdge = e.announced;
        if (lastSrc > x.lastSource) x.lastSource = lastSrc;
      });
    });
    state.exposure = exp;
    state.visibleNodes = Array.from(exp.keys());

    /* a loop stays listed while every leg has at least one deal in the filter */
    var vis = new Set(state.visible.map(function (e) { return e.id; }));
    state.visibleLoops = state.loops.filter(function (lp) {
      return lp.legs.every(function (leg) { return leg.edge_ids.some(function (id) { return vis.has(id); }); });
    });
    state.loopsOf = new Map();
    state.visibleLoops.forEach(function (lp) {
      lp.entities.forEach(function (id) {
        if (!state.loopsOf.has(id)) state.loopsOf.set(id, []);
        state.loopsOf.get(id).push(lp);
      });
    });
  }

  /* top counterparties by counted money (deal count breaks ties); share of the company's counted total */
  function topCounterparties(x, n) {
    var rows = [];
    x.cp.forEach(function (c, id) { rows.push({ id: id, usd: c.usd, n: c.n }); });
    rows.sort(function (a, b) { return (b.usd - a.usd) || (b.n - a.n); });
    rows.forEach(function (r) { r.share = x.total ? r.usd / x.total : 0; });
    return rows.slice(0, n || 5);
  }

  /* ---------- circular deals ---------- */
  /* stats.circular from build.py: [{entities:[a,b(,c)], legs:[{from,to,edge_ids,usd,kinds}], min_usd, max_usd}].
     Each loop gets a stable key for the hash and the selection; legs whose deals are not in the file are dropped. */
  function normalizeLoops(list) {
    var out = [];
    list.forEach(function (lp) {
      if (!lp || !Array.isArray(lp.entities) || !Array.isArray(lp.legs) || lp.entities.length < 2) return;
      var legs = lp.legs.map(function (leg) {
        return {
          from: leg.from, to: leg.to, edge_ids: (leg.edge_ids || []).filter(function (id) { return state.edgeById.has(id); }),
          usd: typeof leg.usd === "number" && leg.usd > 0 ? leg.usd : null,
          kinds: Array.isArray(leg.kinds) ? leg.kinds : []
        };
      });
      if (legs.some(function (l) { return !l.edge_ids.length; })) return;
      var usds = legs.map(function (l) { return l.usd; });
      var anyNull = usds.some(function (u) { return u == null; }), anyNum = usds.some(function (u) { return u != null; });
      out.push({
        key: lp.entities.join("|"), entities: lp.entities, legs: legs,
        min_usd: typeof lp.min_usd === "number" ? lp.min_usd : (anyNull ? null : Math.min.apply(null, usds)),
        max_usd: typeof lp.max_usd === "number" ? lp.max_usd : (anyNum ? Math.max.apply(null, usds.map(function (u) { return u || 0; })) : null)
      });
    });
    out.sort(function (a, b) { return ((b.max_usd || 0) - (a.max_usd || 0)) || ((b.min_usd || 0) - (a.min_usd || 0)); });
    return out;
  }

  /* the same loops computed from the edges (older graph.json files): two-way pairs and three-way rings, cancelled
     deals excluded, a leg being every live deal from one company to the next */
  function computeLoops(edges) {
    var pair = new Map();
    edges.forEach(function (e) {
      if (e.status === "cancelled") return;
      var k = e.from + "|" + e.to;
      if (!pair.has(k)) pair.set(k, []);
      pair.get(k).push(e);
    });
    function leg(a, b) {
      var es = pair.get(a + "|" + b);
      var usd = es.reduce(function (sum, e) { return sum + countedAmount(e); }, 0);
      var kinds = [];
      es.forEach(function (e) { if (kinds.indexOf(e.kind) < 0) kinds.push(e.kind); });
      return { from: a, to: b, edge_ids: es.map(function (e) { return e.id; }), usd: usd || null, kinds: kinds };
    }
    var out = [], ids = [];
    pair.forEach(function (es, k) { k.split("|").forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); }); });
    ids.sort();
    ids.forEach(function (a) {
      ids.forEach(function (b) {
        if (b <= a || !pair.has(a + "|" + b) || !pair.has(b + "|" + a)) return;
        out.push({ entities: [a, b], legs: [leg(a, b), leg(b, a)] });
      });
    });
    ids.forEach(function (a) {
      ids.forEach(function (b) {
        if (b === a || b < a || !pair.has(a + "|" + b)) return;
        ids.forEach(function (c) {
          if (c === a || c === b || c < a || !pair.has(b + "|" + c) || !pair.has(c + "|" + a)) return;
          out.push({ entities: [a, b, c], legs: [leg(a, b), leg(b, c), leg(c, a)] });
        });
      });
    });
    return out;
  }

  /* stats.timeline shape: [{month, count, usd, cumulative_usd, by_kind}] by month of announcement */
  function computeTimeline(edges) {
    var m = new Map();
    edges.forEach(function (e) {
      var ym = (e.announced || "").slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(ym)) return;
      if (!m.has(ym)) m.set(ym, { month: ym, count: 0, usd: 0, cumulative_usd: 0, by_kind: {} });
      var row = m.get(ym), a = countedAmount(e);
      row.count++; row.usd += a; row.by_kind[e.kind] = (row.by_kind[e.kind] || 0) + a;
    });
    var rows = Array.from(m.values()).sort(function (a, b) { return a.month < b.month ? -1 : 1; });
    var cum = 0;
    rows.forEach(function (r) { cum += r.usd; r.cumulative_usd = cum; });
    return rows;
  }

  function periodLabel() {
    var f = state.filters;
    if (f.period !== "custom") {
      var p = PERIODS.filter(function (x) { return x[0] === f.period; })[0];
      if (p) return t(p[1]);
    }
    return (f.from ? day(f.from) : "…") + " – " + (f.to ? day(f.to) : "…");
  }

  /* active filters in a fixed order: the count, the pills and the empty-state line all use this */
  function activeFilters() {
    var f = state.filters, out = [];
    if (f.onlyNew) out.push({ key: "new", label: t("pill_new", { n: state.newIds.size }) });
    if (f.confirmedOnly) out.push({ key: "confirmed", label: t("pill_confirmed") });
    if (f.bindingOnly) out.push({ key: "binding", label: t("pill_binding") });
    if (f.group) out.push({ key: "group", label: t("pill_group", { v: I.group(state.lang, f.group) }) });
    if (f.min) out.push({ key: "min", label: "≥ " + usd(f.min) });
    if (f.from || f.to) out.push({ key: "period", label: periodLabel() });
    if (f.q) out.push({ key: "q", label: t("pill_q", { v: f.q }) });
    if (f.kinds.size < KIND_ORDER.length) out.push({ key: "kinds", label: t("pill_kinds", { n: f.kinds.size }) });
    return out;
  }

  function clearFilter(key) {
    var f = state.filters;
    if (key === "new") f.onlyNew = false;
    else if (key === "confirmed") f.confirmedOnly = false;
    else if (key === "binding") f.bindingOnly = false;
    else if (key === "group") f.group = "";
    else if (key === "min") f.min = 0;
    else if (key === "period") setPeriod("all");
    else if (key === "q") { f.q = ""; $("f-search").value = ""; }
    else if (key === "kinds") f.kinds = new Set(KIND_ORDER);
  }

  function filtersChanged() {
    buildFilterControls();
    renderAll(false, false, true);
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
    document.querySelectorAll("[data-i18n-aria]").forEach(function (el) {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
    });
    /* the full example does not fit a phone-width field in English */
    $("f-search").placeholder = t(mq("(max-width: 480px)").matches ? "f_search_ph_short" : "f_search_ph");
    $("lang-en").setAttribute("aria-pressed", String(!zh));
    $("lang-zh").setAttribute("aria-pressed", String(zh));
    $("graph-hint").textContent = COARSE ? t("graph_hint_touch") : t("graph_hint");
    $("disc-en").textContent = I.STR.en.footer_disclaimer;
    $("disc-zh").textContent = I.STR.zh.footer_disclaimer;
    document.querySelectorAll("#graph-scope [data-scope]").forEach(function (b) {
      var v = b.getAttribute("data-scope");
      b.textContent = v === "all" ? t("scope_all") : t("scope_n", { n: v });
    });
    var ts = $("t-sort");
    ts.textContent = "";
    SORTS.forEach(function (s) { ts.appendChild(h("option", { value: s[0], text: t(s[1]) })); });
    ts.value = SORTS.some(function (s) { return s[0] === state.sort.key; }) ? state.sort.key : "";
    $("csv").textContent = t("csv", { n: state.visible.length });
    $("f-confirmed").title = t("f_confirmed_hint");
    $("f-binding").title = t("f_binding_hint");
    $("tl-note").textContent = state.timelineNote && state.timelineNote[state.lang] ? state.timelineNote[state.lang] : t("tl_hint");
    $("about-cite").textContent = citation();
    var eb = $("error-banner");
    if (!eb.hidden) showError(eb.getAttribute("data-kind") || "load");
    if (!state.raw) renderLive();
  }

  /* the citation line (also in the public README): generated_at's day, or the snapshot day */
  function citation() {
    var d = SNAPSHOT || ((state.raw && state.raw.generated_at) || "").slice(0, 10) || isoDay(new Date());
    return "AI Orders & Debt Map, helajo, " + d + ", " + SITE_URL + (SNAPSHOT ? "?snapshot=" + SNAPSHOT : "");
  }

  function buildFilterControls() {
    var f = state.filters;
    var counts = {};
    state.edges.forEach(function (e) { counts[e.kind] = (counts[e.kind] || 0) + 1; });
    var chips = $("kind-chips");
    chips.textContent = "";
    KIND_ORDER.forEach(function (k) {
      chips.appendChild(h("button", {
        type: "button", class: "chip", "data-kind": k, "aria-pressed": String(f.kinds.has(k)), style: "--c:" + kindColor(k),
        onclick: function () {
          if (f.kinds.has(k)) f.kinds.delete(k); else f.kinds.add(k);
          this.setAttribute("aria-pressed", String(f.kinds.has(k)));
          renderAll(false, false, true);
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
    PERIODS.forEach(function (p) { ps.appendChild(h("option", { value: p[0], text: t(p[1]) })); });
    ps.value = f.period;
    $("f-from").value = f.from;
    $("f-to").value = f.to;
    $("f-from-field").hidden = f.period !== "custom";
    $("f-to-field").hidden = f.period !== "custom";
    $("f-search").value = f.q;
    $("f-confirmed").setAttribute("aria-pressed", String(f.confirmedOnly));
    $("f-binding").setAttribute("aria-pressed", String(f.bindingOnly));

    var dl = $("f-ents");
    dl.textContent = "";
    Array.from(state.ents.keys()).map(function (id) { return optionLabel(id); })
      .sort(function (a, b) { return a.localeCompare(b, state.lang === "zh" ? "zh-CN" : "en"); })
      .forEach(function (v) { dl.appendChild(h("option", { value: v })); });
  }

  /* the parts of the filter bar that follow the filter state: count, pills, reset, date fields */
  function renderFilterState() {
    var f = state.filters;
    var act = activeFilters();
    var reset = $("f-reset");
    reset.hidden = !act.length;
    reset.textContent = act.length ? t("f_reset", { n: act.length }) : "";
    $("f-more-n").textContent = act.length ? t("f_more_n", { n: act.length }) : "";
    document.querySelectorAll("#kind-chips .chip[data-kind]").forEach(function (c) {
      c.setAttribute("aria-pressed", String(f.kinds.has(c.getAttribute("data-kind"))));
    });
    $("f-confirmed").setAttribute("aria-pressed", String(f.confirmedOnly));
    $("f-binding").setAttribute("aria-pressed", String(f.bindingOnly));
    $("f-from-field").hidden = f.period !== "custom";
    $("f-to-field").hidden = f.period !== "custom";

    var box = $("f-pills");
    var focusIdx = -1;
    if (box.contains(document.activeElement)) focusIdx = Array.prototype.indexOf.call(box.children, document.activeElement);
    box.textContent = "";
    act.forEach(function (a) {
      box.appendChild(h("button", {
        type: "button", class: "fpill", "data-clear": a.key, "aria-label": t("pill_clear", { v: a.label }),
        onclick: function () {
          var idx = Array.prototype.indexOf.call(box.children, this);
          clearFilter(a.key);
          filtersChanged();
          var next = box.children[Math.min(idx, box.children.length - 1)];
          (next || $("f-search")).focus();
        }
      }, [a.label, h("span", { "aria-hidden": "true", text: " ×" })]));
    });
    if (focusIdx >= 0 && box.children[focusIdx]) box.children[focusIdx].focus();
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

  /* exact entity match for the search box: localized name (with ticker), name, name_zh, ticker or id */
  function entityMatch(v, optionsOnly) {
    var s = String(v || "").trim().toLowerCase();
    if (!s) return null;
    var hit = null;
    state.ents.forEach(function (e, id) {
      if (hit) return;
      var keys = optionsOnly ? [optionLabel(id)] : [optionLabel(id), e.name, e.name_zh, e.ticker, e.id];
      if (keys.some(function (k) { return k && String(k).toLowerCase() === s; })) hit = id;
    });
    return hit;
  }

  function wireControls() {
    $("lang-en").addEventListener("click", function () { setLang("en"); });
    $("lang-zh").addEventListener("click", function () { setLang("zh"); });

    var qTimer;
    var search = $("f-search");
    function pickEntity(id) {
      clearTimeout(qTimer);
      state.filters.q = "";
      search.value = "";
      renderFilterState();
      renderAll(false, false, true);
      select({ type: "node", id: id });
      zoomToNode(id);
    }
    search.addEventListener("input", function (ev) {
      var v = this.value;
      /* a pick from the datalist arrives as one replacement */
      if (!ev.inputType || ev.inputType === "insertReplacementText") {
        var id = entityMatch(v, true);
        if (id) { pickEntity(id); return; }
      }
      clearTimeout(qTimer);
      qTimer = setTimeout(function () { state.filters.q = v.trim().toLowerCase(); renderAll(false, false, true); }, 160);
    });
    search.addEventListener("change", function () {
      var id = entityMatch(this.value);
      if (id) pickEntity(id);
    });
    search.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter") return;
      var id = entityMatch(this.value);
      if (id) { ev.preventDefault(); pickEntity(id); }
    });

    $("f-group").addEventListener("change", function () { state.filters.group = this.value; renderAll(false, false, true); });
    $("f-min").addEventListener("change", function () { state.filters.min = Number(this.value) || 0; renderAll(false, false, true); });
    $("f-period").addEventListener("change", function () {
      setPeriod(this.value);
      renderAll(false, false, true);
      if (this.value === "custom") $("f-from").focus();
    });
    $("f-from").addEventListener("change", function () { state.filters.from = this.value; state.filters.period = "custom"; $("f-period").value = "custom"; renderAll(false, false, true); });
    $("f-to").addEventListener("change", function () { state.filters.to = this.value; state.filters.period = "custom"; $("f-period").value = "custom"; renderAll(false, false, true); });
    $("f-reset").addEventListener("click", function () {
      state.filters = defaultFilters();
      filtersChanged();
      $("f-search").focus();
    });
    $("f-more").addEventListener("click", function () {
      var open = this.getAttribute("aria-expanded") !== "true";
      this.setAttribute("aria-expanded", String(open));
      $("filters").classList.toggle("is-open", open);
    });

    $("f-confirmed").addEventListener("click", function () {
      state.filters.confirmedOnly = !state.filters.confirmedOnly;
      this.setAttribute("aria-pressed", String(state.filters.confirmedOnly));
      renderAll(false, false, true);
    });
    $("f-binding").addEventListener("click", function () {
      state.filters.bindingOnly = !state.filters.bindingOnly;
      this.setAttribute("aria-pressed", String(state.filters.bindingOnly));
      renderAll(false, false, true);
    });
    $("tl-clear").addEventListener("click", function () { setPeriod("all"); renderAll(false, false, true); });

    var tabs = VIEWS.map(function (v) { return $("tab-" + v); });
    tabs.forEach(function (b, i) {
      b.addEventListener("click", function () { setView(VIEWS[i]); });
      b.addEventListener("keydown", function (ev) {
        var j = ev.key === "ArrowRight" ? (i + 1) % tabs.length : ev.key === "ArrowLeft" ? (i + tabs.length - 1) % tabs.length : -1;
        if (j < 0) return;
        ev.preventDefault();
        tabs[j].focus(); tabs[j].click();
      });
    });

    /* about & methodology: a native dialog (focus stays inside, Esc closes) */
    var about = $("about");
    $("about-open").addEventListener("click", function () {
      $("about-cite").textContent = citation();
      $("about-copied").textContent = "";
      if (typeof about.showModal === "function") about.showModal(); else about.setAttribute("open", "");
    });
    $("about-close").addEventListener("click", function () { if (about.open) about.close(); else about.removeAttribute("open"); });
    about.addEventListener("click", function (ev) { if (ev.target === about) about.close(); });
    $("about-copy").addEventListener("click", function () {
      var line = citation(), done = $("about-copied");
      var p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(line) : Promise.reject(new Error("no clipboard"));
      p.then(function () { done.textContent = t("about_copied"); }, function () {
        /* no clipboard API (older browser, insecure context): select the line so the user can copy it */
        var r = document.createRange(); r.selectNodeContents($("about-cite"));
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      });
    });
    document.querySelectorAll("#graph-scope [data-scope]").forEach(function (b) {
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-scope");
        state.scope = v === "all" ? "all" : Number(v);
        renderScopeButtons();
        renderGraph(false, false, true);
      });
    });
    $("t-sort").addEventListener("change", function () {
      var s = SORTS.filter(function (x) { return x[0] === this.value; }, this)[0];
      if (!s) return;
      state.sort = { key: s[0], dir: s[2] };
      renderTable();
    });
    $("csv").addEventListener("click", downloadCSV);
    $("zoom-in").addEventListener("click", function () { zoomBy(1.35); });
    $("zoom-out").addEventListener("click", function () { zoomBy(1 / 1.35); });
    $("zoom-fit").addEventListener("click", function () { fitView(true); });

    /* live status popover */
    var liveBtn = $("live"), pop = $("live-pop");
    function closePop(refocus) {
      if (pop.hidden) return;
      pop.hidden = true;
      liveBtn.setAttribute("aria-expanded", "false");
      if (refocus) liveBtn.focus();
    }
    liveBtn.addEventListener("click", function () {
      var open = pop.hidden;
      pop.hidden = !open;
      liveBtn.setAttribute("aria-expanded", String(open));
      if (open) renderLive();
    });
    $("live-check").addEventListener("click", function () { closePop(true); load(); });
    document.addEventListener("click", function (ev) {
      if (pop.hidden) return;
      var wrap = liveBtn.closest(".live-wrap") || liveBtn.parentNode;
      if (wrap && !wrap.contains(ev.target)) {
        /* give focus back only if it was inside the popover; a click elsewhere keeps its own focus */
        closePop(wrap.contains(document.activeElement));
      }
    });
    $("retry").addEventListener("click", function () { load(); });

    /* new-deals bar */
    /* "Show them": only the new deals (other filters are set aside, since they may hide them),
       newest first in the table, scrolled into view; the "New deals" pill or Reset brings the rest back */
    $("new-show").addEventListener("click", function () {
      state.filters = defaultFilters();
      state.filters.onlyNew = true;
      $("f-search").value = "";
      state.sort = { key: "date", dir: -1 };
      filtersChanged();
      setView("table");
      $("workspace").scrollIntoView({ block: "start", behavior: RM.matches ? "auto" : "smooth" });
    });
    $("new-dismiss").addEventListener("click", function () {
      state.filters.onlyNew = false;
      state.newIds.clear();
      state.newDismissed = true;
      state.lastNewCount = 0;
      $("new-bar").hidden = true;
      renderAll(false, true);
    });

    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") return;
      if (!pop.hidden) { closePop(true); return; }
      if (state.sel) select(null);
    });
    window.addEventListener("hashchange", function () { readHash(); renderSelection(); renderPanel(); });
    document.addEventListener("visibilitychange", function () {
      if (!SNAPSHOT && !document.hidden && Date.now() - state.lastFetch > REFRESH_MS) load();
    });

    /* touch: one finger scrolls the page, so a long one-finger drag on the map shows the two-finger hint */
    var gv = $("graph-view"), tStart = 0, tShown = false, gTimer;
    gv.addEventListener("touchstart", function (ev) {
      tStart = ev.touches.length === 1 ? Date.now() : 0;
      tShown = false;
    }, { passive: true });
    gv.addEventListener("touchmove", function (ev) {
      if (ev.touches.length !== 1 || !tStart || tShown) return;
      if (Date.now() - tStart > 300) {
        tShown = true;
        var g = $("graph-gesture");
        g.hidden = false;
        clearTimeout(gTimer);
        gTimer = setTimeout(function () { g.hidden = true; }, 1500);
      }
    }, { passive: true });
    ["pointerdown", "wheel"].forEach(function (type) {
      gv.addEventListener(type, function () { state.lastInteract = Date.now(); }, { passive: true });
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
    if (VIEWS.indexOf(v) < 0) v = "graph";
    state.view = v;
    VIEWS.forEach(function (name) {
      $("tab-" + name).setAttribute("aria-selected", String(v === name));
      $("tab-" + name).tabIndex = v === name ? 0 : -1;
      $(name + "-view").hidden = v !== name;
    });
    $("graph-tools").hidden = v !== "graph";
    $("graph-scope").hidden = v !== "graph";
    $("legend").hidden = v !== "graph";
    $("csv").hidden = v !== "table";
    $("table-sort-wrap").hidden = v !== "table";
    if (v === "table") renderTable();
    if (v === "loops") renderLoops();
    if (v === "changes") renderChanges();
    renderEmpty();
    // phones and tablets: a company sheet left open from the graph would cover the table or the lists
    if (v !== "graph" && state.sel && window.matchMedia && window.matchMedia("(max-width: 1080px)").matches) select(null);
    renderVizCount();
  }

  /* the table always lists every visible deal; the graph may show only the Top N */
  function renderVizCount() {
    var sc = G.scopeCount;
    if (!state.raw) { $("viz-count").textContent = ""; return; }
    $("viz-count").textContent = state.scope === "all" || state.view !== "graph" || !sc
      ? t("viz_all", { d: state.visible.length, c: state.visibleNodes.length })
      : t("viz_scope", { n: sc.n, total: state.visibleNodes.length, d: sc.d });
  }

  function renderScopeButtons() {
    document.querySelectorAll("#graph-scope [data-scope]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-scope") === String(state.scope)));
    });
  }

  /* ---------- selection & hash ---------- */
  function select(sel, opts) {
    opts = opts || {};
    var prev = state.sel;
    if (sel && opts.kbd) {
      var ae = document.activeElement;
      var inPanel = ae && $("panel").contains(ae);
      /* moving between panels keeps the control that first opened them */
      if (!(inPanel && state.opener && state.opener.isConnected)) state.opener = ae;
    }
    state.sel = sel;
    var hash = sel ? ({ node: "n-", edge: "e-", bundle: "b-", loop: "l-" }[sel.type]) + sel.id : "";
    try {
      history.replaceState(null, "", hash ? "#" + hash : location.pathname + location.search);
    } catch (e) { /* sandboxed */ }
    renderSelection();
    renderPanel();
    if (state.view === "table") renderTable();
    if (sel) {
      if (!prev || prev.type !== sel.type || prev.id !== sel.id) srStatus(t("sr_selected", { name: selName(sel) }));
      if (opts.kbd) {
        var pt = document.getElementById("panel-title");
        if (pt) pt.focus({ preventScroll: !mq("(min-width: 1081px)").matches });
      }
      revealAboveSheet(sel);
    } else if (prev) {
      var o = state.opener;
      state.opener = null;
      if (o && o.isConnected && typeof o.focus === "function") o.focus({ preventScroll: true });
    }
  }

  /* phones: the bottom sheet covers the lower half of the screen, so bring the selected
     company (or the middle of the selected line) into the strip of graph above it, first by
     scrolling the page up to the graph, then by panning the map if that is not enough */
  function revealAboveSheet(sel) {
    if (!mq("(max-width: 1080px)").matches || state.view !== "graph" || !G.nodes || !G.svg) return;
    var drawer = !mq("(max-width: 760px)").matches;
    var a, b;
    if (sel.type === "node") a = b = G.nodes.get(sel.id);
    else if (sel.type === "loop") { var lp0 = loopByKey(sel.id); a = lp0 && G.nodes.get(lp0.entities[0]); b = lp0 && G.nodes.get(lp0.entities[1]); }
    else {
      var e = sel.type === "edge" ? state.edgeById.get(sel.id) : null;
      var parts = e ? [e.from, e.to] : String(sel.id).split("|");
      a = G.nodes.get(parts[0]); b = G.nodes.get(parts[1]);
    }
    if (!a || !b || a.x == null || b.x == null) return;
    var gv = $("graph-view"), r = gv.getBoundingClientRect(), panel = $("panel");
    var sheetTop = window.innerHeight - (panel.offsetHeight || window.innerHeight * 0.55);
    var tr = d3.zoomTransform(G.svg.node());
    var px = tr.x + tr.k * (a.x + b.x) / 2, py = tr.y + tr.k * (a.y + b.y) / 2;   /* in graph coordinates */
    if (drawer) {
      /* 761-1080px: the drawer covers the right side; pan the point into the part left of it */
      var dl = window.innerWidth - (panel.offsetWidth || 0);
      var x0 = r.left + 24, x1 = Math.min(r.right, dl) - 24;
      var y0 = Math.max(r.top, 0) + 40, y1 = Math.min(r.bottom, window.innerHeight) - 40;
      var qx = r.left + px, qy = r.top + py;
      if (x1 - x0 < 80 || y1 - y0 < 80) return;
      if (qx < x0 || qx > x1 || qy < y0 || qy > y1) {
        var ddx = qx < x0 || qx > x1 ? (x0 + x1) / 2 - qx : 0, ddy = qy < y0 || qy > y1 ? (y0 + y1) / 2 - qy : 0;
        var dd = DUR(300);
        (dd ? G.svg.transition().duration(dd) : G.svg).call(G.zoom.translateBy, ddx / tr.k, ddy / tr.k);
      }
      return;
    }
    var top = r.top, scroll = 0;
    var bandBot = sheetTop - 36;
    if (top + py > bandBot || top + py < 40) {
      /* scroll so the graph's top edge sits just under the top of the screen */
      scroll = Math.max(0, top - 8);
      top -= scroll;
    }
    if (scroll > 0) window.scrollBy({ top: scroll, behavior: RM.matches ? "auto" : "smooth" });
    var visTop = Math.max(top, 0) + 40, visBot = Math.min(top + r.height, bandBot);
    if (visBot - visTop < 60) return;
    var sy = top + py;
    if (sy < visTop || sy > visBot) {
      var dy = (visTop + visBot) / 2 - sy, dx = Math.max(0, Math.min(r.width, px)) - px;
      var d = DUR(300);
      (d ? G.svg.transition().duration(d) : G.svg).call(G.zoom.translateBy, dx / tr.k, dy / tr.k);
    }
  }

  /* #n-<entity>, #e-<edge>, #b-<from|to|kind>, #l-<a|b(|c)>; an empty or unknown hash clears the selection */
  function readHash() {
    var m = /^#([nebl])-(.+)$/.exec(location.hash || "");
    state.sel = null;
    if (!m) return;
    var id = decodeURIComponent(m[2]);
    if (m[1] === "n" && state.ents.has(id)) state.sel = { type: "node", id: id };
    if (m[1] === "e" && state.edgeById.has(id)) state.sel = { type: "edge", id: id };
    if (m[1] === "b" && bundleEdges(id, state.edges).length) state.sel = { type: "bundle", id: id };
    if (m[1] === "l" && loopByKey(id)) state.sel = { type: "loop", id: id };
  }

  function bundleEdges(bk, list) {
    return (list || state.visible).filter(function (e) { return bundleKey(e) === bk; })
      .sort(function (a, b) { return (b.amount_usd || 0) - (a.amount_usd || 0); });
  }

  /* ---------- render orchestration ---------- */
  /* refit: a filter changed, so re-frame the graph on what is left (a data refresh keeps the user's zoom) */
  var srTimer;
  function renderAll(first, langOnly, refit) {
    computeVisible();
    renderFilterState();
    renderSummary();
    renderGraph(first, langOnly, refit);
    renderPanel();
    renderOverview();
    /* the feed and the change log never follow the filters: skip them on a filter change (refit) */
    if (!refit) renderFeeds();
    if (state.view === "table") renderTable();
    if (state.view === "loops") renderLoops();
    if (state.view === "changes" && !refit) renderChanges();
    $("loops-n").textContent = state.visibleLoops.length ? String(state.visibleLoops.length) : "";
    renderTimeline(first || langOnly);
    renderEmpty();
    renderNewBar(first);
    $("csv").textContent = t("csv", { n: state.visible.length });
    $("graph-svg").setAttribute("aria-label", t("graph_aria", { n: state.visibleNodes.length, d: state.visible.length }));
    if (refit) {
      clearTimeout(srTimer);
      srTimer = setTimeout(function () { srStatus(t("sr_showing", { n: state.visible.length, total: state.edges.length })); }, 600);
    }
    renderLive();
  }

  function renderNewBar(first) {
    var n = state.newIds.size, bar = $("new-bar");
    var show = n > 0 && !state.newDismissed && !SNAPSHOT;
    bar.hidden = !show;
    if (show) $("new-bar-text").textContent = n === 1 ? t("new_bar_one") : t("new_bar", { n: n });
    if (show && !first && n > state.lastNewCount) srStatus($("new-bar-text").textContent);
    state.lastNewCount = n;
  }

  /* one tile per kind; the guarantee tile is contingent exposure and sits outside the headline total */
  var TILE_KINDS = ["order", "investment", "debt", "lease", "guarantee"];
  function renderSummary() {
    var sums = {}, nulls = {}, deals = {}, cancelled = {}, total = 0;
    TILE_KINDS.forEach(function (k) { sums[k] = 0; nulls[k] = 0; deals[k] = 0; cancelled[k] = 0; });
    state.visible.forEach(function (e) {
      total += countedAmount(e);
      if (!(e.kind in sums)) return;
      deals[e.kind]++;
      if (e.status === "cancelled") cancelled[e.kind]++;
      else if (e.amount_usd) sums[e.kind] += e.kind === "guarantee" ? contingentAmount(e) : countedAmount(e);
      else nulls[e.kind]++;
    });
    TILE_KINDS.forEach(function (k) {
      var el = $("sum-" + k);
      el.textContent = "";
      var parts = deals[k] ? I.fmtUSDParts(sums[k] || null, state.lang) : { n: "–", u: "" };
      el.appendChild(h("span", { class: "n", text: parts.n }));
      if (parts.u) el.appendChild(h("span", { class: "u", text: parts.u }));
      var note = $("sum-" + k + "-note");
      note.textContent = "";
      /* the full note, plus a short one that phones show in the narrow tiles */
      var full = h("span", { class: "note-full" }), short = h("span", { class: "note-short" });
      var fullParts = [], shortParts = [];
      if (nulls[k]) { fullParts.push(t("sum_undisclosed", { n: nulls[k] })); shortParts.push(t("sum_undisclosed_short", { n: nulls[k] })); }
      if (cancelled[k]) { fullParts.push(t("sum_cancelled", { n: cancelled[k] })); shortParts.push(t("sum_cancelled_short", { n: cancelled[k] })); }
      var sep = state.lang === "zh" ? "，" : " · ";
      full.textContent = fullParts.join(sep);
      short.textContent = shortParts.join(sep);
      note.appendChild(full);
      note.appendChild(short);
      $("tile-" + k).title = t(k === "guarantee" ? "sum_hint_contingent" : k === "lease" ? "sum_hint_lease" : "sum_hint");
    });
    /* the headline total: the same rule as stats.total_usd in graph.json (orders + investments + debt + leases +
       vendor financing, disclosed and not cancelled; guarantees excluded) */
    var tot = $("sum-total");
    tot.textContent = "";
    tot.appendChild(h("span", { class: "tile__total-l", text: t("sum_total") }));
    tot.appendChild(h("b", { text: usdSum(total, state.visible.length) }));
    tot.title = t("sum_total_hint");
    renderMix();
    /* how much of the total rests on filings vs press reports, and how much is binding */
    var conf = 0, rep = 0, bind = 0;
    state.visible.forEach(function (e) {
      var a = countedAmount(e);
      if (e.confidence === "confirmed") conf += a; else rep += a;
      if (isBinding(e)) bind += a;
    });
    var split = $("sum-split");
    split.textContent = "";
    if (state.visible.length) {
      split.appendChild(h("span", { class: "split__conf", title: t("cf_hint_confirmed") }, [t("sum_split", { c: usd(conf || null), r: usd(rep || null) })]));
      split.appendChild(h("span", { class: "split__bind", title: t("f_binding_hint") }, [" · " + t("sum_split_binding", { b: usd(bind || null) })]));
    }
    var scope = t("sum_caption", { d: state.visible.length, c: state.visibleNodes.length });
    if (state.visibleLoops.length) scope += " · " + t("sum_loops", { n: state.visibleLoops.length });
    if (activeFilters().length) scope += " · " + t("sum_scope_filtered");
    $("sum-scope").textContent = scope;
  }

  /* the mix bar counts every deal that passes the other filters, so a class switched off stays as a grey
     segment that can be switched back on */
  function renderMix() {
    var box = $("sum-mix");
    var ae = document.activeElement;
    var refocus = ae && box.contains(ae) ? ae.getAttribute("data-kind") : null;
    box.textContent = "";
    var f = state.filters, cls = {}, total = 0, count = 0;
    state.edges.forEach(function (e) {
      if (!edgeVisible(e, "kinds")) return;
      var c = classOf(e.kind);
      if (!cls[c]) cls[c] = { v: 0, n: 0 };
      cls[c].v += countedAmount(e); cls[c].n++;
      total += countedAmount(e); count++;
    });
    var present = CLASSES.filter(function (c) { return cls[c]; });
    if (!present.length) return;
    var bar = h("div", { class: "mix__bar" });
    present.forEach(function (c) {
      var x = cls[c];
      var share = total ? x.v / total : x.n / count;
      var kinds = classKinds(c);
      var on = kinds.every(function (k) { return f.kinds.has(k); });
      var label = t("mix_seg_title", { k: classLabel(c), v: usdSum(x.v, x.n), n: x.n });
      bar.appendChild(h("button", {
        type: "button", class: "mix__seg", "data-kind": c, "aria-pressed": String(on), title: label, "aria-label": label,
        style: "--c:" + classColor(c) + ";flex-grow:" + Math.max(share, 0.012).toFixed(4),
        onclick: function () {
          if (on) kinds.forEach(function (k) { f.kinds.delete(k); });
          else kinds.forEach(function (k) { f.kinds.add(k); });
          filtersChanged();
        }
      }));
    });
    box.appendChild(bar);
    var labels = h("div", { class: "mix__labels" });
    present.slice().sort(function (a, b) { return (cls[b].v - cls[a].v) || (cls[b].n - cls[a].n); }).slice(0, 3).forEach(function (c) {
      var pct = total ? Math.round(cls[c].v / total * 100) : Math.round(cls[c].n / count * 100);
      labels.appendChild(h("span", { class: "mix__lbl", style: "--c:" + classColor(c) }, [classLabel(c) + " ", h("b", { text: pct + "%" })]));
    });
    box.appendChild(labels);
    if (refocus) {
      var b = box.querySelector('[data-kind="' + refocus + '"]');
      if (b) b.focus();
    }
  }

  /* ---------- live status ---------- */
  function renderLive() {
    var raw = state.raw;
    var live = $("live");
    if (!raw) {
      var st0 = state.fetchFailed ? "offline" : "loading";
      live.setAttribute("data-state", st0);
      $("live-state").textContent = t(st0);
      $("live-text").textContent = "";
      $("live-dl").textContent = "";
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
    $("live-text").textContent = state.fetchFailed
      ? t("offline_since", { t: I.fmtDateTime(gen, state.lang) })
      : t("updated", { t: I.ago(gen, state.lang) });
    live.title = gen ? I.fmtDateTime(gen, state.lang) : "";

    var dl = $("live-dl");
    dl.textContent = "";
    function row(label, value, opts) {
      opts = opts || {};
      dl.appendChild(h("div", { class: "live__row" + (opts.warn ? " live__row--warn" : "") }, [
        h("dt", { text: label }),
        h("dd", { title: opts.title || null }, [value, opts.note ? h("small", { text: opts.note }) : null])
      ]));
    }
    row(t("pop_built"), gen ? I.ago(gen, state.lang) : t("never"), { title: gen ? I.fmtDateTime(gen, state.lang) : null });
    row(t("pop_monitor"), mon.last_run ? I.ago(mon.last_run, state.lang) : t("never"),
      { title: mon.last_run ? I.fmtDateTime(mon.last_run, state.lang) : null, note: t("pop_monitor_note") });
    row(t("pop_sources"), t("pop_sources_v", { sec: num(mon.sec_items), news: num(mon.news_items) }));
    /* monitor.candidates (edges waiting for review) is not shown: the site lists curated deals only */
    if (!SNAPSHOT) {
      var mins = Math.max(0, Math.ceil((state.lastFetch + REFRESH_MS - Date.now()) / 60000));
      row(t("pop_next"), t("in_min", { n: mins }));
    }
    if (mon.claude_enabled) row(t("claude_on"), mon.model || "✓");
    var srcs = mon.sources || {};
    [["sec", "src_sec"], ["news", "src_news"]].forEach(function (k) {
      var s = srcs[k[0]];
      if (s && s.ok === false) {
        row(t(k[1]), t("src_fail_short"), { warn: true, title: (s.errors || []).slice(0, 3).join("\n") || t("src_fail", { s: t(k[1]) }) });
      }
    });

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
    G.sectorLayer = G.layer.append("g").attr("class", "sectors");
    G.edgeLayer = G.layer.append("g").attr("class", "edges");
    G.hitLayer = G.layer.append("g").attr("class", "hits");
    G.nodeLayer = G.layer.append("g").attr("class", "nodes");
    /* lines of the selected or hovered company are lifted above the circles, so an unrelated
       circle can never hide them or their arrowheads (they stop at their own circles' edges) */
    G.hotLayer = G.layer.append("g").attr("class", "edges edges--hot");
    G.labelLayer = G.layer.append("g").attr("class", "labels");
    G.nodes = new Map();
    G.zoom = d3.zoom().scaleExtent([0.15, 6])
      /* one finger scrolls the page; two fingers move and zoom the map */
      .filter(function (ev) {
        if (ev.type === "touchstart") return ev.touches.length > 1;
        return (!ev.ctrlKey || ev.type === "wheel") && !ev.button;
      })
      .on("zoom", function (ev) {
        G.layer.attr("transform", ev.transform);
        var k = ev.transform.k;
        G.k = k;
        svg.classed("zin", k >= Math.min(1.6, Math.max(1.2, (G.fitK || 1) * 1.5)));
        /* keep labels readable on screen when zoomed out (phones), without ballooning when zoomed in */
        svg.style("--ls", Math.max(1, Math.min(G.width < 600 ? 1.3 : 1.9, 1 / Math.pow(k, 0.8))).toFixed(3));
        clearTimeout(G.lblTimer);
        G.lblTimer = setTimeout(function () { updateSectorVis(); declutterLabels(); }, 120);
      })
      .on("end", function () { updateHitSizes(); });
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
      .on("end", function () {
        var unpinned = false;
        (G.nodeList || []).forEach(function (n) {
          if (n.refreshPin) { n.fx = null; n.fy = null; n.refreshPin = false; unpinned = true; }
        });
        if (unpinned) drawPositions();
        declutterLabels();
        placeSectorLabels();
      });
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
    if (!a) return 1;
    var v = (Math.log10(a) - 8) / (Math.log10(3e11) - 8);
    return 1 + Math.max(0, Math.min(1, v)) * 4.6;
  }

  function rankByExposure(a, b) { return (b.total - a.total) || (b.deals - a.deals); }

  function renderGraph(first, langOnly, refit) {
    var gv = $("graph-view");
    if (first || !G.width) { G.width = gv.clientWidth || 800; G.height = gv.clientHeight || 600; }
    var maxTotal = 0;
    state.exposure.forEach(function (x) { if (x.total > maxTotal) maxTotal = x.total; });
    var sc = Math.max(0.42, Math.min(1, G.width / 900));
    var portrait = G.height > G.width * 1.1;
    G.sc = sc;
    var rScale = d3.scaleSqrt().domain([0, maxTotal || 1]).range([6, G.width < 600 ? 24 : 32]);
    G.rScale = rScale;
    G.maxTotal = maxTotal;

    /* Top N: the N largest companies by exposure and only the deals between them */
    var gEdges = state.visible, nodeIds = state.visibleNodes;
    if (state.scope !== "all") {
      var top = new Set(Array.from(state.exposure.entries()).sort(function (a, b) { return rankByExposure(a[1], b[1]); })
        .slice(0, state.scope).map(function (x) { return x[0]; }));
      gEdges = state.visible.filter(function (e) { return top.has(e.from) && top.has(e.to); });
      var seen = new Set();
      gEdges.forEach(function (e) { seen.add(e.from); seen.add(e.to); });
      nodeIds = state.visibleNodes.filter(function (id) { return seen.has(id); });
    }
    G.scopeCount = { n: nodeIds.length, d: gEdges.length };
    renderVizCount();

    /* nodes: reuse simulation objects so positions survive refreshes */
    var nodes = nodeIds.map(function (id) {
      var n = G.nodes.get(id);
      var ent = state.ents.get(id);
      if (!n) {
        var a = anchorFor(ent.group);
        n = { id: id, x: a.x + (Math.random() - 0.5) * 60, y: a.y + (Math.random() - 0.5) * 60, fresh: true };
        G.nodes.set(id, n);
      } else if (!langOnly) {
        n.fresh = G.nodeList ? G.nodeList.indexOf(n) < 0 : true;
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
    gEdges.forEach(function (e) {
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
      /* width follows the counted total (cancelled deals and guarantees add nothing); the label shows the live
         face amounts so a bundle of guarantees still reads as its size */
      var counted = arr.reduce(function (sum, x) { return sum + countedAmount(x); }, 0);
      var amt = arr.reduce(function (sum, x) { return sum + countedAmount(x) + contingentAmount(x); }, 0) || null;
      var key = e.from < e.to ? e.from + "|" + e.to : e.to + "|" + e.from;
      var l = {
        id: arr.length === 1 ? e.id : "b:" + bk, bk: bk, e: e, edges: arr, amount: amt, counted: counted, from: e.from, to: e.to, kind: e.kind,
        source: nodeIndex.get(e.from), target: nodeIndex.get(e.to), key: key, w: widthScale(counted)
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
    drawHits();
    drawNodes();
    drawLabels();
    renderLegend();

    if (langOnly) { drawPositions(); renderSelection(); declutterLabels(); placeSectorLabels(); return; }
    if (!nodes.length) { G.sim.stop(); placeSectorLabels(); renderSelection(); return; }
    if (first) {
      G.sim.alpha(1);
      for (var i = 0; i < 320; i++) G.sim.tick();
      drawPositions();
      fitView(false);
      G.sim.alpha(0).restart();
      declutterLabels();
      placeSectorLabels();
    } else if (refit && nodes.length) {
      G.sim.stop();
      G.sim.alpha(0.6);
      for (var j = 0; j < 220; j++) G.sim.tick();
      drawPositions();
      fitView(true);
      G.sim.alpha(0).restart();
      placeSectorLabels();
      setTimeout(declutterLabels, DUR(400) + 50);
    } else if (RM.matches) {
      /* reduced motion: settle off screen and draw once */
      G.sim.stop();
      G.sim.alpha(0.3);
      for (var m = 0; m < 200; m++) G.sim.tick();
      drawPositions();
      declutterLabels();
      placeSectorLabels();
    } else if (state.sel || Date.now() - state.lastInteract < 60000) {
      /* the user is looking at something: keep the known companies still and let only new ones find a place */
      var placed = nodes.filter(function (n) { return !n.fresh; });
      placed.forEach(function (n) { if (n.fx == null) { n.fx = n.x; n.fy = n.y; n.refreshPin = true; } });
      nodes.forEach(function (n) {
        if (!n.fresh) return;
        var sx = 0, sy = 0, c = 0;
        links.forEach(function (l) {
          var o = l.source === n ? l.target : l.target === n ? l.source : null;
          if (o && !o.fresh) { sx += o.x; sy += o.y; c++; }
        });
        if (c) { n.x = sx / c + (Math.random() - 0.5) * 30; n.y = sy / c + (Math.random() - 0.5) * 30; }
      });
      G.sim.alpha(0.15).restart();
    } else {
      G.sim.alpha(0.45).restart();
    }
    renderSelection();
  }

  function drawEdges() {
    /* lifted lines go back to the normal layer first, so the data join sees (and can remove) them */
    if (G.hotLayer) G.hotLayer.selectAll("g.edge-g").each(function () { G.edgeLayer.node().appendChild(this); });
    var sel = G.edgeLayer.selectAll("g.edge-g").data(G.links, function (l) { return l.id; });
    sel.exit().remove();
    var enter = sel.enter().append("g").attr("class", "edge-g");
    enter.append("path").attr("class", "new-halo");
    enter.append("path").attr("class", "edge-casing");
    enter.append("path").attr("class", "edge");
    enter.append("path").attr("class", "arrow");
    var all = enter.merge(sel);
    all.order();
    all.each(function (l) {
      var g = d3.select(this);
      var isNew = l.edges.some(function (x) { return state.newIds.has(x.id); });
      /* no deal on this line has a disclosed amount: thinnest width, dashed */
      var undisclosed = l.edges.every(function (x) { return x.amount_usd == null; });
      var wh = Math.max(l.w, 2.5);
      g.classed("is-undisclosed", undisclosed).style("--c", kindColor(l.kind)).style("--wh", wh + "px");
      g.select(".edge")
        .attr("class", "edge" + (isNew ? " edge--new" : ""))
        .style("stroke-width", l.w + "px");
      g.select(".edge-casing").style("stroke-width", (wh + 4) + "px");
      g.select(".new-halo").style("display", isNew ? null : "none").style("stroke-width", (l.w + 7) + "px");
    });
    G.edgeSel = all;
  }

  function sameSel(a, b) { return !!a && !!b && a.type === b.type && a.id === b.id; }
  function setHover(hv) {
    if (sameSel(hv, state.hover) || (!hv && !state.hover)) return;
    state.hover = hv;
    renderSelection();
  }

  /* invisible hit lines above all edges, thick ones last so they sit on top */
  function drawHits() {
    var list = G.links.slice().sort(function (a, b) { return a.w - b.w; });
    var sel = G.hitLayer.selectAll("path.edge-hit").data(list, function (l) { return l.id; });
    sel.exit().remove();
    var enter = sel.enter().append("path").attr("class", "edge-hit")
      .on("pointerenter pointermove", function (ev, l) { setHover(linkSel(l)); showLinkTip(ev, l); })
      .on("pointerleave", function () { hideTip(); setHover(null); })
      .on("click", function (ev, l) { ev.stopPropagation(); hideTip(); select(linkSel(l)); });
    G.hitSel = enter.merge(sel);
    G.hitSel.order();
    updateHitSizes();
  }

  /* hit areas are constant on screen: line hits use non-scaling strokes, node hits are divided by the zoom */
  function updateHitSizes() {
    var k = G.k || 1;
    var minW = COARSE ? 20 : 12, add = COARSE ? 10 : 8;
    if (G.hitSel) G.hitSel.attr("stroke-width", function (l) { return Math.max(minW, l.w * k + add).toFixed(1); });
    if (G.nodeSel) G.nodeSel.select(".node__hit").attr("r", function (d) { return Math.max(d.r + 3, (COARSE ? 22 : 12) / k); });
  }

  function nodeAria(d) {
    var sep = state.lang === "zh" ? "，" : ", ";
    return [entName(d.id), I.group(state.lang, d.ent.group), usdSum(d.exp.total, d.exp.deals), t("t_count", { n: d.exp.deals })].join(sep);
  }

  function rankedNodes() {
    return (G.nodeList || []).slice().sort(function (a, b) { return rankByExposure(a.exp, b.exp); });
  }
  /* roving tabindex: one company is in the tab order, arrow keys move between them */
  function setRoving(id) {
    G.rovingId = id;
    if (G.nodeSel) G.nodeSel.attr("tabindex", function (d) { return d.id === id ? 0 : -1; });
  }
  function focusNode(id) {
    if (!G.nodeSel) return;
    setRoving(id);
    var el = G.nodeSel.filter(function (d) { return d.id === id; }).node();
    if (el) el.focus();
  }
  function nodeKey(ev, d) {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      select({ type: "node", id: d.id }, { kbd: true });
      return;
    }
    var list = rankedNodes();
    var i = list.indexOf(d), j = null;
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown") j = Math.min(list.length - 1, i + 1);
    else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") j = Math.max(0, i - 1);
    else if (ev.key === "Home") j = 0;
    else if (ev.key === "End") j = list.length - 1;
    if (j == null) return;
    ev.preventDefault();
    if (list[j]) focusNode(list[j].id);
  }

  function drawNodes() {
    var sel = G.nodeLayer.selectAll("g.node").data(G.nodeList, function (d) { return d.id; });
    sel.exit().remove();
    var enter = sel.enter().append("g").attr("class", "node").attr("role", "button");
    enter.append("circle").attr("class", "node__hit");
    enter.append("circle").attr("class", "node__ring");
    enter.append("circle").attr("class", "node__c");
    enter
      .on("pointerenter", function (ev, d) { setHover({ type: "node", id: d.id }); showNodeTip(ev, d); })
      .on("pointermove", function (ev, d) { showNodeTip(ev, d); })
      .on("pointerleave", function () { hideTip(); setHover(null); })
      .on("click", function (ev, d) { ev.stopPropagation(); hideTip(); select({ type: "node", id: d.id }, { kbd: ev.detail === 0 }); })
      .on("keydown", nodeKey)
      .on("focus", function (ev, d) { setRoving(d.id); setHover({ type: "node", id: d.id }); })
      .on("blur", function () { setHover(null); })
      .call(d3.drag().clickDistance(4)
        .filter(function (ev) { return !ev.ctrlKey && !ev.button && !ev.touches && ev.pointerType !== "touch"; })
        .on("start", function (ev, d) { if (!ev.active) G.sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; d.refreshPin = false; hideTip(); })
        .on("drag", function (ev, d) { d.fx = ev.x; d.fy = ev.y; })
        .on("end", function (ev, d) { if (!ev.active) G.sim.alphaTarget(0); d.fx = null; d.fy = null; }));
    var all = enter.merge(sel);
    all.each(function (d) {
      var g = d3.select(this);
      g.classed("node--pool", isPool(d.id)).attr("aria-label", nodeAria(d));
      g.select(".node__c").attr("r", d.r);
      g.select(".node__ring").attr("r", d.r + 4);
    });
    G.nodeSel = all;
    var keep = state.sel && state.sel.type === "node" && G.nodes.get(state.sel.id) && G.nodeList.indexOf(G.nodes.get(state.sel.id)) >= 0
      ? state.sel.id
      : (G.rovingId && G.nodeList.some(function (n) { return n.id === G.rovingId; }) ? G.rovingId : (rankedNodes()[0] || {}).id);
    setRoving(keep);
    updateHitSizes();
  }

  function drawLabels() {
    var sel = G.labelLayer.selectAll("text.node__label").data(G.nodeList, function (d) { return d.id; });
    sel.exit().remove();
    var enter = sel.enter().append("text").attr("class", "node__label").attr("text-anchor", "middle").attr("aria-hidden", "true")
      .on("pointerenter", function (ev, d) { setHover({ type: "node", id: d.id }); showNodeTip(ev, d); })
      .on("pointerleave", function () { hideTip(); setHover(null); })
      .on("click", function (ev, d) { ev.stopPropagation(); hideTip(); select({ type: "node", id: d.id }); });
    var all = enter.merge(sel);
    var big = d3.quantile(G.nodeList.map(function (n) { return n.r; }).sort(d3.ascending), 0.55) || 10;
    all.attr("data-id", function (d) { return d.id; })
      .classed("node__label--big", function (d) { return d.r >= big; })
      .classed("node__label--small", function (d) { return d.r < big; })
      .text(function (d) { return shortName(d.id); });
    G.labelSel = all;
  }

  /* w: the drawn width, so the arrowhead grows with an emphasised line */
  /* How far (along the line's canonical normal) a highlighted line must bow so that it passes
     clear of every circle it is not connected to. 0 when the straight line is already clear. */
  function avoidOffset(l) {
    var s = l.source, tg = l.target;
    var dx = tg.x - s.x, dy = tg.y - s.y;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / dist, ny = dx / dist;
    if (l.canonFlip) { nx = -nx; ny = -ny; }
    var best = 0, bestNeed = 0;
    (G.nodeList || []).forEach(function (n) {
      if (n === s || n === tg) return;
      var px = n.x - s.x, py = n.y - s.y;
      var t = (px * dx + py * dy) / (dist * dist);
      if (t <= 0.08 || t >= 0.92) return;
      var sd = px * nx + py * ny;            /* signed distance of the circle from the line */
      var clear = n.r + 7;
      if (Math.abs(sd) >= clear) return;
      var need = clear + Math.abs(sd);        /* bow to the far side of the circle */
      if (need > bestNeed) {
        bestNeed = need;
        /* a quadratic curve with control offset o is displaced 2t(1-t)o at parameter t */
        best = -(sd >= 0 ? 1 : -1) * need / Math.max(0.18, 2 * t * (1 - t));
      }
    });
    var cap = dist * 0.7;
    return Math.max(-cap, Math.min(cap, best));
  }

  function edgeGeometry(l, w, extra) {
    var s = l.source, tg = l.target;
    var dx = tg.x - s.x, dy = tg.y - s.y;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    /* normal from the canonical (sorted id) direction, so A->B and B->A bow apart */
    var nx = -dy / dist, ny = dx / dist;
    if (l.canonFlip) { nx = -nx; ny = -ny; }
    var off = l.offset * 2 + (extra || 0);
    var cx = (s.x + tg.x) / 2 + nx * off, cy = (s.y + tg.y) / 2 + ny * off;
    var sdx = cx - s.x, sdy = cy - s.y, sl = Math.sqrt(sdx * sdx + sdy * sdy) || 1;
    var edx = tg.x - cx, edy = tg.y - cy, el = Math.sqrt(edx * edx + edy * edy) || 1;
    var ux = edx / el, uy = edy / el;
    var head = 5 + (w || l.w) * 1.3;
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
    var hot = G.hotSet;
    G.edgeSel.each(function (l) {
      var isHot = !!(hot && hot.has(l.id));
      var lifted = !!(G.liftSet && G.liftSet.has(l.id));
      var geo = edgeGeometry(l, isHot ? Math.max(l.w, 2.5) : l.w, lifted ? avoidOffset(l) : 0);
      l.path = geo.line;
      var g = d3.select(this);
      g.select(".edge").attr("d", geo.line);
      g.select(".edge-casing").attr("d", geo.line);
      g.select(".new-halo").attr("d", geo.line);
      g.select(".arrow").attr("d", geo.arrow);
    });
    if (G.hitSel) G.hitSel.attr("d", function (l) { return l.path; });
    var tf = function (d) { return "translate(" + d.x + "," + d.y + ")"; };
    G.nodeSel.attr("transform", tf);
    if (G.labelSel) G.labelSel.attr("transform", tf);
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
    var d = animate ? DUR(400) : 0;
    (d ? G.svg.transition().duration(d) : G.svg).call(G.zoom.transform, tr);
  }

  function zoomBy(f) {
    var d = DUR(250);
    (d ? G.svg.transition().duration(d) : G.svg).call(G.zoom.scaleBy, f);
  }

  function zoomToNode(id) {
    var n = G.nodes && G.nodes.get(id);
    if (!n || !G.nodeList || G.nodeList.indexOf(n) < 0 || state.view !== "graph") return;
    var gv = $("graph-view");
    var w = gv.clientWidth || G.width, hh = gv.clientHeight || G.height;
    var k = Math.min(6, Math.max((G.fitK || 1) * 1.8, 1.2));
    var tr = d3.zoomIdentity.translate(w / 2 - k * n.x, hh / 2 - k * n.y).scale(k);
    var d = DUR(450);
    (d ? G.svg.transition().duration(d) : G.svg).call(G.zoom.transform, tr);
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
    } else if (focus && focus.type === "loop") {
      var lpf = loopByKey(focus.id);
      if (lpf) { nodesOn = new Set(lpf.entities); edgesOn = loopLinkIds(lpf); }
    } else if (focus) {
      var fl = focusLink(focus);
      if (fl) { nodesOn = new Set([fl.from, fl.to]); edgesOn = new Set([fl.id]); }
    }
    G.nodesOn = nodesOn;
    /* lines that close a loop with the selected company (or the selected loop's own legs) get the ring */
    var loopOn = new Set();
    if (state.sel && state.sel.type === "node") {
      (state.loopsOf.get(state.sel.id) || []).forEach(function (lp) { loopLinkIds(lp).forEach(function (id) { loopOn.add(id); }); });
    } else if (state.sel && state.sel.type === "loop") {
      var lps = loopByKey(state.sel.id);
      if (lps) loopOn = loopLinkIds(lps);
    }
    var selLink = state.sel && state.sel.type !== "node" ? focusLink(state.sel) : null;
    var hotNode = state.hover && state.hover.type === "node" ? state.hover.id : null;
    var selNode = state.sel && state.sel.type === "node" ? state.sel.id : null;
    function dim(d) { return nodesOn ? !nodesOn.has(d.id) : false; }
    function nbr(d) { return nodesOn ? nodesOn.has(d.id) : false; }
    function isSel(d) { return d.id === selNode; }
    G.nodeSel.classed("is-dim", dim).classed("is-nbr", nbr).classed("is-sel", isSel)
      .classed("is-hot", function (d) { return d.id === hotNode; });
    if (G.labelSel) G.labelSel.classed("is-dim", dim).classed("is-nbr", nbr).classed("is-sel", isSel);
    G.edgeSel
      .classed("is-dim", function (l) { return edgesOn ? !edgesOn.has(l.id) : false; })
      .classed("is-hot", function (l) { return edgesOn ? edgesOn.has(l.id) : false; })
      .classed("is-sel", function (l) { return !!selLink && selLink.id === l.id; })
      .classed("is-loop", function (l) { return loopOn.has(l.id); });
    /* Lifting lines above the circles and bending them around other circles follows the clicked
       selection only, never hover: a hovered line that moved away from the pointer would end the hover,
       snap back under it and start it again, so the graph flickered. */
    var liftOn = null, sel = state.sel;
    if (sel && sel.type === "node") {
      liftOn = new Set();
      G.links.forEach(function (l) { if (l.from === sel.id || l.to === sel.id) liftOn.add(l.id); });
    } else if (sel && sel.type === "loop") {
      liftOn = loopOn;
    } else if (sel) {
      var sl = focusLink(sel);
      if (sl) liftOn = new Set([sl.id]);
    }
    var liftKey = liftOn ? Array.from(liftOn).sort().join(",") : "";
    var changed = !!(G.hotSet || edgesOn) || liftKey !== (G.liftKey || "");
    G.hotSet = edgesOn;
    G.liftSet = liftOn;
    G.liftKey = liftKey;
    G.edgeSel.each(function (l) {
      var want = liftOn && liftOn.has(l.id) ? G.hotLayer.node() : G.edgeLayer.node();
      if (this.parentNode !== want) want.appendChild(this);
    });
    if (changed) drawPositions();
    updateSectorVis();
    clearTimeout(G.declTimer);
    G.declTimer = setTimeout(declutterLabels, 60);
  }

  function linkSel(l) { return l.edges.length === 1 ? { type: "edge", id: l.e.id } : { type: "bundle", id: l.bk }; }
  function focusLink(f) {
    if (!f || !G.links) return null;
    if (f.type === "edge") return G.linkOfEdge && G.linkOfEdge.get(f.id) || null;
    if (f.type === "bundle") return G.links.filter(function (l) { return l.bk === f.id; })[0] || null;
    return null;
  }

  /* Show as many labels as fit. Unfocused: biggest companies first, capped so a phone is not a wall of text.
     Focused (hover or selection): only the focus and its neighbours, the focus first, then neighbours by
     the money that flows with the focus. Each label tries several spots around its circle and is hidden
     only when every spot would overlap a label already shown or a bigger circle. */
  function declutterLabels() {
    if (!G.labelSel || !G.nodeList) return;
    var k = G.k || 1, pad = 2.5 / k;
    var focus = state.hover || state.sel;
    var nodesOn = focus ? G.nodesOn : null;
    var items = [];
    G.labelSel.each(function (d) {
      this.classList.remove("is-hidden");
      this.setAttribute("x", 0); this.setAttribute("y", d.r + 13); this.setAttribute("text-anchor", "middle");
    });
    G.labelSel.each(function (d) {
      if (nodesOn && !nodesOn.has(d.id)) { items.push({ el: this, d: d, skip: true }); return; }
      var b;
      try { b = this.getBBox(); } catch (e) { return; }
      items.push({ el: this, d: d, w: b.width, h: b.height, asc: (d.r + 13) - b.y });
    });
    items.forEach(function (it) { if (it.skip) it.el.classList.add("is-hidden"); });
    items = items.filter(function (it) { return !it.skip; });

    var focusId = null;
    if (nodesOn) {
      var amt = {};
      if (focus.type === "node") {
        focusId = focus.id;
        G.links.forEach(function (l) {
          if (l.from === focusId) amt[l.to] = (amt[l.to] || 0) + (l.amount || 0);
          else if (l.to === focusId) amt[l.from] = (amt[l.from] || 0) + (l.amount || 0);
        });
      }
      items.sort(function (a, b) {
        if (a.d.id === focusId) return -1;
        if (b.d.id === focusId) return 1;
        return ((amt[b.d.id] || 0) - (amt[a.d.id] || 0)) || (b.d.r - a.d.r);
      });
    } else {
      items.sort(function (a, b) { return (b.d.r - a.d.r) || ((b.d.exp.total || 0) - (a.d.exp.total || 0)); });
    }
    var narrow = G.width < 600;
    var cap = nodesOn || k > (G.fitK || 1) * 1.4 ? Infinity : (narrow ? 14 : 28);
    var always = narrow ? 5 : 8;

    var placed = [];
    /* in focus mode the faded circles do not block a label: only the lit ones do */
    var circles = G.nodeList.filter(function (n) { return !nodesOn || nodesOn.has(n.id); })
      .map(function (n) { return { x: n.x, y: n.y, r: n.r, id: n.id }; });
    /* the visible area in layer coordinates: a label must not be cut off by the edge of the graph */
    var tr = d3.zoomTransform(G.svg.node()), gv = $("graph-view");
    var vw = gv.clientWidth || G.width, vh = gv.clientHeight || G.height;
    var vx0 = (4 - tr.x) / tr.k, vy0 = (4 - tr.y) / tr.k, vx1 = (vw - 4 - tr.x) / tr.k, vy1 = (vh - 4 - tr.y) / tr.k;
    function free(it, x0, y0, loose) {
      var x1 = x0 + it.w, y1 = y0 + it.h;
      if (x0 < vx0 || x1 > vx1 || y0 < vy0 || y1 > vy1) return null;
      x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
      if (placed.some(function (p) { return x0 < p.x1 && x1 > p.x0 && y0 < p.y1 && y1 > p.y0; })) return null;
      var hit = circles.some(function (c) {
        if (c.id === it.d.id) return false;
        /* strict pass: any circle of a comparable size blocks; loose pass: only circles bigger than our own */
        if (loose ? c.r <= it.d.r : c.r < it.d.r * 0.6) return false;
        var cx = Math.max(x0, Math.min(c.x, x1)), cy = Math.max(y0, Math.min(c.y, y1));
        return (cx - c.x) * (cx - c.x) + (cy - c.y) * (cy - c.y) < c.r * c.r;
      });
      return hit ? null : { x0: x0, y0: y0, x1: x1, y1: y1 };
    }
    var shown = 0;
    items.forEach(function (it, rank) {
      if (shown >= cap) { it.el.classList.add("is-hidden"); return; }
      var d = it.d, r = d.r, gap = 4;
      var opts = [
        { x: 0, y: r + 13, a: "middle", bx: d.x - it.w / 2, by: d.y + r + 13 - it.asc },
        { x: 0, y: -(r + gap + it.h - it.asc), a: "middle", bx: d.x - it.w / 2, by: d.y - r - gap - it.h },
        { x: r + gap, y: it.asc - it.h / 2, a: "start", bx: d.x + r + gap, by: d.y - it.h / 2 },
        { x: -(r + gap), y: it.asc - it.h / 2, a: "end", bx: d.x - r - gap - it.w, by: d.y - it.h / 2 }
      ];
      if (nodesOn) {
        [14, -14].forEach(function (dy) {
          opts.push({ x: r + gap, y: it.asc - it.h / 2 + dy, a: "start", bx: d.x + r + gap, by: d.y - it.h / 2 + dy });
          opts.push({ x: -(r + gap), y: it.asc - it.h / 2 + dy, a: "end", bx: d.x - r - gap - it.w, by: d.y - it.h / 2 + dy });
        });
      }
      var passes = nodesOn ? (d.id === focusId || !focusId ? 2 : 1) : (rank < always ? 2 : 1);
      for (var pass = 0; pass < passes; pass++) {
        for (var i = 0; i < opts.length; i++) {
          var box = free(it, opts[i].bx, opts[i].by, pass === 1);
          if (box) {
            it.el.setAttribute("x", opts[i].x); it.el.setAttribute("y", opts[i].y); it.el.setAttribute("text-anchor", opts[i].a);
            placed.push(box);
            shown++;
            return;
          }
        }
      }
      it.el.classList.add("is-hidden");
    });
    G.labelBoxes = placed;
    G.labelCircles = circles;
    fitSectorLabels();
  }

  /* move each sector name off the company labels and circles (further out first, then
     closer in, then up or down); when no spot is free it is left out rather than drawn
     underneath a company name */
  function fitSectorLabels() {
    if (!G.sectorLayer || !G.labelBoxes) return;
    var boxes = G.labelBoxes, circles = G.labelCircles || [], k = G.k || 1, pad = 3 / k;
    var mine = [];
    /* the visible area in layer coordinates, less the overlays (count, zoom tools) */
    var tr = d3.zoomTransform(G.svg.node()), gv = $("graph-view");
    var vw = gv.clientWidth || G.width, vh = gv.clientHeight || G.height, inset = vw < 600 ? 44 : 8;
    var vx0 = (8 - tr.x) / tr.k, vy0 = (inset - tr.y) / tr.k, vx1 = (vw - inset - tr.x) / tr.k, vy1 = (vh - 8 - tr.y) / tr.k;
    G.sectorLayer.selectAll("text.sector-label").each(function (d) {
      if (this.classList.contains("is-hidden")) return;
      this.classList.remove("is-clash");
      this.setAttribute("x", d.x); this.setAttribute("y", d.y);
      var b;
      try { b = this.getBBox(); } catch (e) { return; }
      if (!b.width) return;
      var w = b.width, hgt = b.height, ox = b.x - d.x, oy = b.y - d.y;
      var tries = [[60, 0], [90, 0], [120, 0], [36, 0], [60, -18], [60, 18], [90, -18], [90, 18]];
      for (var i = 0; i < tries.length; i++) {
        var x = d.mx + d.ux * tries[i][0], y = d.my + d.uy * tries[i][0] + tries[i][1] / k;
        var x0 = x + ox - pad, y0 = y + oy - pad, x1 = x0 + w + 2 * pad, y1 = y0 + hgt + 2 * pad;
        if (x0 < vx0 || x1 > vx1 || y0 < vy0 || y1 > vy1) continue;
        var clash = boxes.concat(mine).some(function (p) { return x0 < p.x1 && x1 > p.x0 && y0 < p.y1 && y1 > p.y0; }) ||
          circles.some(function (c) {
            var cx = Math.max(x0, Math.min(c.x, x1)), cy = Math.max(y0, Math.min(c.y, y1));
            return (cx - c.x) * (cx - c.x) + (cy - c.y) * (cy - c.y) < c.r * c.r;
          });
        if (!clash) {
          this.setAttribute("x", x); this.setAttribute("y", y);
          mine.push({ x0: x0, y0: y0, x1: x1, y1: y1 });
          return;
        }
      }
      this.classList.add("is-clash");
    });
  }

  /* faint sector names on the canvas, a little outside each cluster of three or more companies */
  function placeSectorLabels() {
    if (!G.sectorLayer || !G.nodeList) return;
    var groups = new Map();
    G.nodeList.forEach(function (n) {
      var g = n.ent.group;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(n);
    });
    var cx = G.width / 2, cy = G.height / 2, data = [];
    groups.forEach(function (arr, g) {
      if (arr.length < 3) return;
      var mx = d3.mean(arr, function (n) { return n.x; }), my = d3.mean(arr, function (n) { return n.y; });
      var dx = mx - cx, dy = my - cy, dd = Math.sqrt(dx * dx + dy * dy) || 1;
      data.push({ g: g, x: mx + dx / dd * 60, y: my + dy / dd * 60, mx: mx, my: my, ux: dx / dd, uy: dy / dd });
    });
    var sel = G.sectorLayer.selectAll("text.sector-label").data(data, function (d) { return d.g; });
    sel.exit().remove();
    sel.enter().append("text").attr("class", "sector-label").attr("text-anchor", "middle").attr("aria-hidden", "true")
      .merge(sel)
      .attr("x", function (d) { return d.x; }).attr("y", function (d) { return d.y; })
      .text(function (d) { return I.group(state.lang, d.g); });
    updateSectorVis();
    fitSectorLabels();
  }
  function updateSectorVis() {
    if (!G.sectorLayer) return;
    var hide = (G.k || 1) > 2 * (G.fitK || 1) || !!state.hover || !!state.sel;
    G.sectorLayer.selectAll("text.sector-label").classed("is-hidden", hide);
  }

  function placeTip(ev) {
    var gv = $("graph-view"), box = gv.getBoundingClientRect();
    var tip = G.tip;
    if (tip.parentNode !== gv) gv.appendChild(tip);   /* the timeline borrows the same tooltip */
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
    tip.appendChild(h("span", { class: "tooltip__v", text: usdSum(d.exp.total, d.exp.deals) }));
    tip.appendChild(h("span", { class: "tooltip__t", text: entName(d.id) + (d.ent.ticker ? " · " + d.ent.ticker : "") }));
    tip.appendChild(h("span", { class: "tooltip__m", text: I.group(state.lang, d.ent.group) + " · " + t("t_count", { n: d.exp.deals }) }));
    tip.appendChild(h("span", { class: "tooltip__m", text: t("p_total_in") + " " + usdSum(d.exp.inflow, d.exp.inDeals) + " · " + t("p_total_out") + " " + usdSum(d.exp.outflow, d.exp.outDeals) }));
    if (d.exp.guarIn || d.exp.guarOut) tip.appendChild(h("span", { class: "tooltip__m", text: t("p_contingent_line", { g: usd(d.exp.guarOut || null), r: usd(d.exp.guarIn || null) }) }));
    tip.hidden = false;
    placeTip(ev);
  }
  function showEdgeTip(ev, e) {
    if (ev.pointerType === "touch") return;
    var tip = G.tip;
    tip.textContent = "";
    var nc = notCountedKey(e);
    tip.appendChild(h("span", { class: "tooltip__v" + (nc === "cancelled" ? " is-cancelled" : ""), text: usd(e.amount_usd) + (nc ? " · " + t(nc) : "") }));
    tip.appendChild(h("span", { class: "tooltip__t", lang: titleLang(e), text: edgeTitle(e) }));
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
    tip.appendChild(h("span", { class: "tooltip__v", text: usd(l.amount) + (l.kind === "guarantee" ? " · " + t("contingent") : "") }));
    tip.appendChild(h("span", { class: "tooltip__t", text: t("p_bundle", { n: l.edges.length }) + " · " + entName(l.from) + " → " + entName(l.to) }));
    tip.appendChild(h("span", { class: "tooltip__m" }, [h("span", { class: "key", style: "--c:" + kindColor(l.kind) }), I.kind(state.lang, l.kind)]));
    l.edges.slice(0, 4).forEach(function (e) {
      tip.appendChild(h("span", { class: "tooltip__m" + (e.status === "cancelled" ? " is-cancelled" : ""), text: usd(e.amount_usd) + " · " + edgeTitle(e) }));
    });
    if (l.edges.length > 4) tip.appendChild(h("span", { class: "tooltip__m", text: "+" + (l.edges.length - 4) }));
    tip.hidden = false;
    placeTip(ev);
  }
  function hideTip() { if (G.tip) G.tip.hidden = true; }

  /* legend: kinds present, three width samples, three circle sizes from the same scales as the graph */
  function renderLegend() {
    var present = new Set((G.links || []).map(function (l) { return classOf(l.kind); }));
    var lk = $("legend-kinds");
    lk.textContent = "";
    CLASSES.forEach(function (c) {
      if (present.has(c)) lk.appendChild(h("span", { class: "lk-kind", style: "--c:" + classColor(c) }, [h("i", { "aria-hidden": "true" }), classLabel(c)]));
    });
    var lw = $("legend-widths");
    lw.textContent = "";
    [1e9, 1e10, 1e11].forEach(function (x) {
      lw.appendChild(h("span", { class: "lk-w" }, [
        h("i", { "aria-hidden": "true", style: "height:" + widthScale(x).toFixed(1) + "px" }),
        usd(x) + (x === 1e11 ? "+" : "")
      ]));
    });
    lw.appendChild(h("span", { class: "legend__hint", text: t("legend_thin") }));
    var lc = $("legend-circles");
    lc.textContent = "";
    if (!G.rScale || !G.maxTotal) return;
    var vals = [1e10, 1e11].filter(function (v) { return v < G.maxTotal * 0.8; }).concat([G.maxTotal]);
    vals.forEach(function (v) {
      var r = Math.min(18, G.rScale(v));
      var size = Math.ceil(r * 2 + 3);
      var svg = svgEl("svg", { class: "lk-c", width: size, height: size, "aria-hidden": "true" });
      svg.appendChild(svgEl("circle", { cx: size / 2, cy: size / 2, r: r.toFixed(1) }));
      lc.appendChild(h("span", { class: "legend__key" }, [svg, h("span", { text: usd(v) })]));
    });
  }

  /* ---------- empty state ---------- */
  function renderEmpty() {
    var none = !!state.raw && !state.visible.length;
    [["graph-empty", "graph"], ["table-empty", "table"]].forEach(function (p) {
      var box = $(p[0]);
      box.textContent = "";
      box.hidden = !(none && state.view === p[1]);
      if (!none) return;
      var f = state.filters;
      var acts = h("div", { class: "empty__acts" });
      if (f.q) acts.appendChild(h("button", { type: "button", class: "btn", text: t("empty_clear_q", { q: f.q }), onclick: function () { clearFilter("q"); filtersChanged(); } }));
      if (f.kinds.size < KIND_ORDER.length) acts.appendChild(h("button", { type: "button", class: "btn", text: t("empty_all_kinds"), onclick: function () { clearFilter("kinds"); filtersChanged(); } }));
      acts.appendChild(h("button", { type: "button", class: "btn", text: t("empty_reset"), onclick: function () { state.filters = defaultFilters(); filtersChanged(); } }));
      box.appendChild(h("p", { class: "empty__t", text: t("empty_t") }));
      var labels = activeFilters().map(function (a) { return a.label; });
      if (labels.length) box.appendChild(h("p", { class: "empty__f", text: labels.join(" · ") }));
      box.appendChild(acts);
    });
  }

  /* ---------- side panel ---------- */
  function statusEl(s) { return h("span", { class: "st st--" + (s || "na"), text: I.status(state.lang, s) }); }
  function confEl(c) {
    return h("span", { class: "cf cf--" + (c || "na"), title: c ? t("cf_hint_" + c) : null, text: I.confidence(state.lang, c) });
  }
  function sourcesEl(e) {
    return h("span", { class: "srcs" }, e.sources.slice(0, 2).map(function (s) {
      return extLink(s.url, s.publisher || hostOf(s.url) || "source");
    }));
  }
  function entButton(id, cls) {
    return h("button", {
      type: "button", class: cls || "prow__who", title: t("p_select_from", { name: entName(id) }),
      onclick: picker({ type: "node", id: id })
    }, [h("span", { text: entName(id) })]);
  }
  /* English text in the Chinese page: lang=en plus a small EN tag */
  function enText(text) {
    if (state.lang !== "zh" || hasCJK(text)) return text;
    return h("span", {}, [h("span", { lang: "en", text: text }), h("span", { class: "xtag", text: t("tag_en") })]);
  }

  function syncSelUI(type) {
    if (type) document.body.setAttribute("data-sel", type);
    else document.body.removeAttribute("data-sel");
    $("panel").classList.toggle("is-open", !!type);
  }

  function renderPanel() {
    var p = $("panel");
    p.textContent = "";
    var sel = state.sel, type = null;
    if (state.raw && sel) {
      if (sel.type === "node" && state.ents.has(sel.id)) { renderNodePanel(p, sel.id); type = "node"; }
      else if (sel.type === "edge" && state.edgeById.has(sel.id)) { renderEdgePanel(p, state.edgeById.get(sel.id)); type = "edge"; }
      else if (sel.type === "bundle") {
        var be = bundleEdges(sel.id);
        if (be.length) { renderBundlePanel(p, be); type = "bundle"; }
      }
      else if (sel.type === "loop") {
        var lp = loopByKey(sel.id);
        if (lp) { renderLoopPanel(p, lp); type = "loop"; }
      }
    }
    if (type && mq("(max-width: 1080px)").matches) p.insertBefore(grabBtn(), p.firstChild);
    syncSelUI(type);
  }

  /* the bottom sheet's handle: a tap or a downward drag of more than 80px closes it */
  function grabBtn() {
    var b = h("button", { type: "button", class: "panel__grab", "aria-label": t("panel_close"), title: t("panel_close") });
    var p = $("panel"), y0 = null, dy = 0, dragged = false;
    function reset() { y0 = null; p.style.transition = ""; p.style.transform = ""; }
    b.addEventListener("pointerdown", function (ev) {
      y0 = ev.clientY; dy = 0; dragged = false;
      try { b.setPointerCapture(ev.pointerId); } catch (e) { /* old browser */ }
    });
    b.addEventListener("pointermove", function (ev) {
      if (y0 == null) return;
      dy = ev.clientY - y0;
      if (dy > 4) dragged = true;
      if (dy > 0 && !RM.matches) { p.style.transition = "none"; p.style.transform = "translateY(" + dy + "px)"; }
    });
    b.addEventListener("pointerup", function () {
      if (y0 == null) return;
      var d = dy;
      reset();
      if (d > 80) select(null);
    });
    b.addEventListener("pointercancel", reset);
    b.addEventListener("click", function () { if (!dragged) select(null); dragged = false; });
    return b;
  }

  function closeBtn() {
    return h("button", { type: "button", class: "icon-btn panel__close", "aria-label": t("panel_close"), title: t("panel_close"), onclick: function () { select(null); } }, ["×"]);
  }
  function panelTitle(text, lang) {
    return h("h2", { class: "panel__title", id: "panel-title", tabindex: "-1", lang: lang || null, text: text });
  }

  /* overview metrics: total money in and out, borrowing (debt + vendor financing received), orders placed */
  function rankMetric(x) {
    if (state.rankBy === "borrowed") {
      return {
        v: (x.byKindIn.debt || 0) + (x.byKindIn.vendor_financing || 0),
        n: (x.nIn.debt || 0) + (x.nIn.vendor_financing || 0),
        byClass: { debt: x.byKindIn.debt || 0, other: x.byKindIn.vendor_financing || 0 }
      };
    }
    if (state.rankBy === "orders") {
      return { v: x.byKindOut.order || 0, n: x.nOut.order || 0, byClass: { order: x.byKindOut.order || 0 } };
    }
    var bc = {};
    Object.keys(x.byKind).forEach(function (k) { var c = classOf(k); bc[c] = (bc[c] || 0) + x.byKind[k]; });
    return { v: x.total, n: x.deals, byClass: bc };
  }

  function renderOverview() {
    var p = $("overview");
    var ae = document.activeElement;
    var refocus = ae && p.contains(ae) ? ae.getAttribute("data-rank") : null;
    p.textContent = "";
    if (!state.raw) return;
    p.appendChild(h("div", { class: "panel__head" }, [
      h("div", { class: "panel__head-main" }, [h("h2", { class: "panel__title", id: "ov-h", text: t("panel_overview") })])
    ]));
    var body = h("div", { class: "panel__body" });
    body.appendChild(h("p", { class: "panel__hint", text: t("panel_overview_hint") }));
    var seg = h("div", { class: "seg seg--sm ov-rank-by", role: "group", "aria-label": t("ov_rank_by") });
    [["total", "rank_total"], ["borrowed", "rank_borrowed"], ["orders", "rank_orders"]].forEach(function (r) {
      seg.appendChild(h("button", {
        type: "button", class: "seg__btn", "data-rank": r[0], "aria-pressed": String(state.rankBy === r[0]), text: t(r[1]),
        onclick: function () { state.rankBy = r[0]; renderOverview(); }
      }));
    });
    body.appendChild(seg);

    /* biggest disclosed totals first; companies whose deals are all undisclosed rank by deal count */
    var rows = [];
    state.exposure.forEach(function (x, id) {
      if (isPool(id)) return;
      var m = rankMetric(x);
      if (m.n > 0) rows.push({ id: id, m: m });
    });
    rows.sort(function (a, b) { return (b.m.v - a.m.v) || (b.m.n - a.m.n); });
    rows = rows.slice(0, 12);
    if (!rows.length) {
      body.appendChild(h("p", { class: "panel__hint", text: t("ov_empty") }));
    } else {
      var present = new Set();
      rows.forEach(function (r) { Object.keys(r.m.byClass).forEach(function (c) { if (r.m.byClass[c] > 0) present.add(c); }); });
      var key = h("div", { class: "ov-key" }, [h("span", { text: t("ov_key") })]);
      CLASSES.forEach(function (c) {
        if (present.has(c)) key.appendChild(h("span", { class: "lk-kind", style: "--c:" + classColor(c) }, [h("i", { "aria-hidden": "true" }), classLabel(c)]));
      });
      body.appendChild(key);
      var max = rows[0].m.v || 1;
      var ol = h("ol", { class: "ov-list" });
      rows.forEach(function (r, i) {
        var parts = [];
        var bar = h("span", { class: "ov-bar", role: "img" });
        CLASSES.forEach(function (c) {
          var v = r.m.byClass[c];
          if (!v) return;
          parts.push(classLabel(c) + " " + usd(v));
          bar.appendChild(h("i", { style: "--c:" + classColor(c) + ";width:" + (v / max * 100).toFixed(2) + "%" }));
        });
        bar.setAttribute("aria-label", parts.join(state.lang === "zh" ? "，" : ", ") || t("undisclosed"));
        ol.appendChild(h("li", {}, [h("button", { type: "button", class: "ov-btn", onclick: picker({ type: "node", id: r.id }) }, [
          h("span", { class: "ov-rank", text: String(i + 1) }),
          h("span", { class: "ov-name" }, [h("span", { text: entName(r.id) })]),
          h("span", { class: "ov-amt", text: usdSum(r.m.v, r.m.n) }),
          bar
        ])]));
      });
      body.appendChild(ol);
      body.appendChild(h("p", { class: "ov-foot", text: t("ov_pool_note") }));
    }
    p.appendChild(body);
    if (refocus) {
      var b = p.querySelector('[data-rank="' + refocus + '"]');
      if (b) b.focus();
    }
  }

  function renderNodePanel(p, id) {
    var ent = state.ents.get(id);
    var x = state.exposure.get(id) || { inflow: 0, outflow: 0, deals: 0, inDeals: 0, outDeals: 0, cancelled: 0, guarIn: 0, guarOut: 0, nGuarIn: 0, nGuarOut: 0 };
    var meta = [ent.ticker, I.region(state.lang, ent.country)].filter(Boolean).join(" · ");
    p.appendChild(h("div", { class: "panel__head" }, [
      h("div", { class: "panel__head-main" }, [
        h("div", { class: "panel__eyebrow" }, [h("span", { class: "tag", text: I.group(state.lang, ent.group) })]),
        panelTitle(entName(id)),
        meta ? h("div", { class: "panel__meta", text: meta }) : null
      ]),
      closeBtn()
    ]));
    var body = h("div", { class: "panel__body" });
    /* three totals share one row: the label above carries the measure, so Chinese drops 美元 to fit */
    body.appendChild(h("div", { class: "panel__totals" }, [
      h("div", { class: "tot tot--in" }, [h("span", { text: t("p_total_in") }), h("b", { text: usdSum(x.inflow, x.inDeals, true) })]),
      h("div", { class: "tot tot--out" }, [h("span", { text: t("p_total_out") }), h("b", { text: usdSum(x.outflow, x.outDeals, true) })]),
      h("div", { class: "tot" }, [h("span", { text: t("p_deals") }), h("b", { text: String(x.deals) })])
    ]));
    /* guarantees are contingent and sit outside Money in / out; cancelled deals are listed below but not counted */
    if (x.nGuarIn || x.nGuarOut) {
      body.appendChild(h("p", { class: "panel__contingent", title: t("not_counted_contingent") }, [
        h("span", { class: "ctag ctag--contingent", text: t("contingent") }),
        t("p_contingent_line", { g: usdSum(x.guarOut, x.nGuarOut), r: usdSum(x.guarIn, x.nGuarIn) })
      ]));
    }
    if (x.cancelled) body.appendChild(h("p", { class: "panel__contingent", text: t("p_cancelled_line", { n: x.cancelled }) }));
    renderNodeExtras(body, id, x);

    /* direction rule: debt from=lender to=borrower; order from=buyer; investment from=investor; lease from=lessee */
    var defs = [
      ["p_owes", "debt", "to"], ["p_owed", "debt", "from"],
      ["p_orders_placed", "order", "from"], ["p_orders_received", "order", "to"],
      ["p_invest_made", "investment", "from"], ["p_invest_received", "investment", "to"],
      ["p_leases_paid", "lease", "from"], ["p_leases_received", "lease", "to"],
      ["p_vf_given", "vendor_financing", "from"], ["p_vf_received", "vendor_financing", "to"],
      ["p_guar_given", "guarantee", "from"], ["p_guar_received", "guarantee", "to"]
    ];
    var secs = [];
    defs.forEach(function (s) {
      var rows = state.visible.filter(function (e) { return e.kind === s[1] && e[s[2]] === id; })
        .sort(function (a, b) { return (b.amount_usd || 0) - (a.amount_usd || 0); });
      if (!rows.length) return;
      /* the section total follows the counting rule; a guarantee section shows its live face amount, tagged */
      var cancelled = rows.filter(function (e) { return e.status === "cancelled"; }).length;
      var total = rows.reduce(function (a, e) { return a + countedAmount(e) + contingentAmount(e); }, 0);
      secs.push({ def: s, rows: rows, total: total, cancelled: cancelled });
    });
    secs.sort(function (a, b) { return (b.total - a.total) || (b.rows.length - a.rows.length); });
    secs.forEach(function (sec) {
      var s = sec.def, rows = sec.rows;
      var list = h("ul", { class: "plist" });
      rows.forEach(function (e, i) {
        list.appendChild(dealRow(e, s[2] === "from" ? e.to : e.from, i >= 3));
      });
      var section = h("section", { class: "psec" }, [
        h("h4", {}, [
          h("span", { class: "key", style: "--c:" + kindColor(s[1]), "aria-hidden": "true" }), t(s[0]),
          h("span", { class: "psec__total" }, [
            usdSum(sec.total, rows.length - sec.cancelled),
            s[1] === "guarantee" ? h("span", { class: "ctag ctag--contingent", text: t("contingent"), title: t("not_counted_contingent") }) : null,
            sec.cancelled ? h("span", { class: "ctag ctag--cancelled", text: t("sum_cancelled_short", { n: sec.cancelled }), title: t("not_counted_cancelled") }) : null
          ])
        ]),
        list
      ]);
      if (rows.length > 3) {
        section.appendChild(h("button", {
          type: "button", class: "psec__more", "aria-expanded": "false", text: t("p_show_all", { n: rows.length }),
          onclick: function () {
            var open = section.classList.toggle("is-expanded");
            this.setAttribute("aria-expanded", String(open));
            this.textContent = open ? t("p_show_fewer") : t("p_show_all", { n: rows.length });
          }
        }));
      }
      body.appendChild(section);
    });
    if (!secs.length) body.appendChild(h("p", { class: "panel__hint", text: t("p_none") }));
    p.appendChild(body);
  }

  /* who the money is with, how sure and how binding it is, how fresh the record is, and the loops it closes
     (the same figures build.py writes as per-entity stats, here over the current filter) */
  function renderNodeExtras(body, id, x) {
    var sep = state.lang === "zh" ? "，" : " · ";
    var top = topCounterparties(x, 5);
    if (top.length && x.total) {
      var sec = h("section", { class: "psec psec--cp" }, [h("h4", { text: t("p_top_cp") })]);
      var ol = h("ol", { class: "cp-list" });
      top.forEach(function (r) {
        var pct = Math.round(r.share * 100);
        ol.appendChild(h("li", {}, [h("button", {
          type: "button", class: "cp-btn", title: t("p_select_from", { name: entName(r.id) }), onclick: picker({ type: "node", id: r.id }),
          "aria-label": entName(r.id) + sep + usdSum(r.usd, r.n) + sep + pct + "%"
        }, [
          h("span", { class: "cp-name" }, [h("span", { text: entName(r.id) })]),
          h("span", { class: "cp-amt", text: usdSum(r.usd, r.n) }),
          h("span", { class: "cp-pct", text: pct + "%" }),
          h("span", { class: "cp-bar", "aria-hidden": "true" }, [h("i", { style: "width:" + Math.max(1, r.share * 100).toFixed(1) + "%" })])
        ])]));
      });
      sec.appendChild(ol);
      var top3 = top.slice(0, 3).reduce(function (a, r) { return a + r.share; }, 0);
      sec.appendChild(h("p", { class: "psec__note", text: t("p_top3", { p: Math.round(top3 * 100) + "%" }) }));
      body.appendChild(sec);
    }
    var kv = h("dl", { class: "kv kv--facts" });
    function row(k, v) { if (v) { kv.appendChild(h("dt", { text: k })); kv.appendChild(h("dd", {}, [v])); } }
    row(t("t_confidence"), x.confirmed || x.reported ? t("sum_split", { c: usd(x.confirmed || null), r: usd(x.reported || null) }) : null);
    row(t("t_status"), x.binding || x.nonBinding ? t("p_binding", { b: usd(x.binding || null), a: usd(x.nonBinding || null) }) : null);
    row(t("p_last_edge"), x.lastEdge ? day(x.lastEdge) : null);
    row(t("p_last_source"), x.lastSource ? day(x.lastSource) : null);
    if (kv.childNodes.length) body.appendChild(kv);
    var loops = state.loopsOf.get(id) || [];
    if (loops.length) {
      var ul = h("ul", { class: "loop-with" });
      loops.forEach(function (lp) {
        var others = lp.entities.filter(function (x2) { return x2 !== id; });
        ul.appendChild(h("li", {}, [h("button", {
          type: "button", class: "loop-btn", onclick: picker({ type: "loop", id: lp.key }), title: t("p_loop_show")
        }, [
          h("span", { class: "loop-btn__who", text: others.map(entName).join(" → ") }),
          h("span", { class: "loop-btn__v", text: lp.min_usd ? t("loop_min", { v: usd(lp.min_usd) }) : t("undisclosed") })
        ])]));
      });
      body.appendChild(h("section", { class: "psec" }, [h("h4", { text: t("p_loop_with") }), ul]));
    }
  }

  function dealRow(e, other, extra) {
    return h("li", { class: "prow" + (extra ? " is-extra" : "") }, [
      entButton(other),
      h("span", { class: "prow__amt-wrap" }, [amtEl(e, "prow__amt"), ctag(e)]),
      h("span", { class: "prow__t" }, [h("button", { type: "button", lang: titleLang(e), onclick: picker({ type: "edge", id: e.id }), text: edgeTitle(e) })]),
      h("span", { class: "prow__m" }, [
        state.newIds.has(e.id) ? h("span", { class: "newtag", text: t("p_new") }) : null,
        h("span", { class: "d", text: dayMeta(e.announced) }), statusEl(e.status), confEl(e.confidence), sourcesEl(e)
      ])
    ]);
  }

  function renderBundlePanel(p, list) {
    var e0 = list[0];
    var total = list.reduce(function (a, e) { return a + countedAmount(e) + contingentAmount(e); }, 0);
    p.appendChild(h("div", { class: "panel__head" }, [
      h("div", { class: "panel__head-main" }, [
        h("div", { class: "panel__eyebrow" }, [h("span", { class: "key", style: "--c:" + kindColor(e0.kind) }), I.kind(state.lang, e0.kind)]),
        panelTitle(entName(e0.from) + " → " + entName(e0.to)),
        h("div", { class: "panel__meta", text: t("p_bundle", { n: list.length }) })
      ]),
      closeBtn()
    ]));
    var body = h("div", { class: "panel__body" });
    body.appendChild(h("div", { class: "deal-amt" }, [usd(total || null), e0.kind === "guarantee" ? ctag(e0) : null]));
    body.appendChild(h("p", { class: "panel__hint", text: t("p_bundle_hint") }));
    var ul = h("ul", { class: "plist" });
    list.forEach(function (e) { ul.appendChild(dealRow(e, e.from === e0.from ? e.to : e.from)); });
    body.appendChild(ul);
    p.appendChild(body);
  }

  function flowBox(id) {
    var ent = state.ents.get(id);
    return h("button", { type: "button", class: "flow__box", title: t("p_select_from", { name: entName(id) }), onclick: picker({ type: "node", id: id }) }, [
      entName(id), h("small", { text: I.group(state.lang, ent ? ent.group : "other") })
    ]);
  }

  function renderEdgePanel(p, e) {
    var zh = state.lang === "zh";
    p.appendChild(h("div", { class: "panel__head" }, [
      h("div", { class: "panel__head-main" }, [
        h("div", { class: "panel__eyebrow" }, [
          h("span", { class: "key", style: "--c:" + kindColor(e.kind) }), I.kind(state.lang, e.kind),
          state.newIds.has(e.id) ? h("span", { class: "newtag", text: t("p_new") }) : null
        ]),
        panelTitle(edgeTitle(e), titleLang(e))
      ]),
      closeBtn()
    ]));
    var body = h("div", { class: "panel__body" });
    body.appendChild(h("div", {}, [
      h("div", { class: "deal-amt" + (e.status === "cancelled" ? " is-cancelled" : "") }, [usd(e.amount_usd), ctag(e)]),
      /* 中文: the edge's own amount_text_zh when curated, else the English text under an "as reported (English)" label */
      zh && e.amount_text_zh ? h("p", { class: "deal-note", text: e.amount_text_zh }) :
      e.amount_text ? h("p", { class: "deal-note" }, [
        zh ? h("span", { text: t("p_amount_note") + "：" }) : null,
        h("span", { lang: "en", text: e.amount_text })
      ]) : null
    ]));
    body.appendChild(h("div", { class: "flow", role: "group", "aria-label": t("p_flow"), style: "--c:" + kindColor(e.kind) }, [
      flowBox(e.from), h("span", { class: "flow__arrow", "aria-hidden": "true" }), flowBox(e.to)
    ]));
    var sum = edgeSummary(e);
    if (sum) body.appendChild(h("p", { class: "deal-summary", lang: zh && !e.summary_zh ? "en" : null, text: sum }));
    var kv = h("dl", { class: "kv" });
    function row(k, v) { if (v) { kv.appendChild(h("dt", { text: k })); kv.appendChild(h("dd", {}, [v])); } }
    row(t("t_status"), statusEl(e.status));
    row(t("t_confidence"), confEl(e.confidence));
    row(t("p_announced"), e.announced ? day(e.announced) : null);
    if (e.subkind || e.subkind_zh) {
      /* 中文: subkind_zh on the edge, else the glossary table in i18n.js, else the English text tagged EN */
      var sk = I.subkind(state.lang, e.subkind, e.subkind_zh);
      row(t("p_subkind"), sk.en && zh ? h("span", {}, [h("span", { lang: "en", text: sk.text }), h("span", { class: "xtag", text: t("tag_en") })]) : sk.text);
    }
    row(t("p_term"), zh && e.term_zh ? e.term_zh : (e.term ? enText(e.term) : null));
    body.appendChild(kv);
    if (e.sources.length) {
      body.appendChild(h("section", { class: "psec" }, [
        h("h4", { text: t("p_sources") }),
        h("ul", { class: "srclist" }, e.sources.map(function (s) {
          return h("li", {}, [
            extLink(s.url, s.title || s.url),
            h("span", { class: "pub", text: [s.publisher || hostOf(s.url), s.date ? dayMeta(s.date) : null].filter(Boolean).join(" · ") })
          ]);
        }))
      ]));
    }
    p.appendChild(body);
  }

  /* ---------- table ---------- */
  var COLS = [
    { key: "date", label: "t_date", cls: "date", get: function (e) { return e.announced || ""; } },
    { key: "kind", label: "t_kind", cls: "kind", get: function (e) { return KIND_ORDER.indexOf(e.kind); } },
    { key: "deal", label: "t_deal", cls: "deal", get: function (e) { return edgeTitle(e).toLowerCase(); } },
    { key: "amount", label: "t_amount", cls: "num", num: true, get: function (e) { return e.amount_usd == null ? -1 : e.amount_usd; } },
    { key: "state", label: "t_state", cls: "state", get: function (e) { return e.status || ""; } },
    { key: "src", label: "t_sources", cls: "src", nosort: true },
    /* sort only (the "Sort by" menu on phones) */
    { key: "company", hidden: true, get: function (e) { return entName(e.from).toLowerCase(); } }
  ];

  function sortedVisible() {
    var col = COLS.filter(function (c) { return c.key === state.sort.key && c.get; })[0] || COLS[0];
    var dir = state.sort.dir;
    var loc = state.lang === "zh" ? "zh-CN" : "en";
    return state.visible.slice().sort(function (a, b) {
      var x = col.get(a), y = col.get(b);
      var c = typeof x === "string" && typeof y === "string" ? x.localeCompare(y, loc) : (x < y ? -1 : x > y ? 1 : 0);
      if (c) return c * dir;
      return (b.amount_usd || 0) - (a.amount_usd || 0);
    });
  }

  function renderTable() {
    var head = $("deals-head");
    head.textContent = "";
    COLS.forEach(function (c) {
      if (c.hidden) return;
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
    var ts = $("t-sort");
    ts.value = SORTS.some(function (s) { return s[0] === state.sort.key; }) ? state.sort.key : "";

    var maxAmt = 0, disclosed = 0, nDisc = 0, nCancelled = 0, nContingent = 0, contingent = 0;
    state.visible.forEach(function (e) {
      var a = countedAmount(e);
      if (a) { disclosed += a; nDisc++; if (a > maxAmt) maxAmt = a; }
      if (e.status === "cancelled") nCancelled++;
      else if (e.kind === "guarantee") { nContingent++; contingent += contingentAmount(e); }
    });
    var body = $("deals-body");
    body.textContent = "";
    var frag = document.createDocumentFragment();
    sortedVisible().forEach(function (e) {
      var ca = countedAmount(e);
      var bar = ca
        /* square-root scale on a fixed track, so a $5B deal is still a visible bar next to a $300B one;
           a cancelled deal or a guarantee gets the dashed "not counted" track */
        ? h("span", { class: "amt-bar", "aria-hidden": "true" }, [
            h("i", { style: "--c:" + kindColor(e.kind) + ";width:" + Math.max(2, Math.sqrt(ca / (maxAmt || 1)) * 56).toFixed(1) + "px" })])
        : h("span", { class: "amt-bar amt-bar--na", "aria-hidden": "true" });
      var tr = h("tr", {
        class: ((state.newIds.has(e.id) ? "is-new" : "") + (state.sel && state.sel.id === e.id ? " is-sel" : "")).trim() || null,
        onclick: function (ev) { if (ev.target.closest("a,button")) return; select({ type: "edge", id: e.id }); }
      }, [
        h("td", { class: "date", text: e.announced || "–" }),
        h("td", { class: "kind" }, [h("span", { class: "kindtag" }, [h("span", { class: "key", style: "--c:" + kindColor(e.kind) }), I.kind(state.lang, e.kind)])]),
        h("td", { class: "deal" }, [
          h("button", { type: "button", class: "deal-t", lang: titleLang(e), onclick: picker({ type: "edge", id: e.id }), text: edgeTitle(e) }),
          h("span", { class: "deal-sub" }, [
            h("span", { class: "who", text: entName(e.from) }),
            h("span", { class: "arr", "aria-hidden": "true", text: "→" }),
            h("span", { class: "who", text: entName(e.to) })
          ])
        ]),
        h("td", { class: "num" }, [e.amount_usd == null ? amtEl(e, "amt") :
          h("span", { class: "amt" + (e.status === "cancelled" ? " is-cancelled" : ""), title: notCountedKey(e) ? t("not_counted_" + notCountedKey(e)) : null }, [usd(e.amount_usd, true),
          /* phones show rows as cards with no column header, so the unit comes back there */
          state.lang === "zh" ? h("span", { class: "amt__u" }, ["美元"]) : null]), ctag(e), bar]),
        h("td", { class: "state" }, [h("div", { class: "stack" }, [statusEl(e.status), confEl(e.confidence)])]),
        h("td", { class: "src" }, [sourcesEl(e)])
      ]);
      frag.appendChild(tr);
    });
    body.appendChild(frag);
    var foot = [t("t_foot", { v: usd(disclosed || null), n: nDisc, d: state.visible.length })];
    if (nContingent) foot.push(t("t_foot_contingent", { n: nContingent, v: usd(contingent || null) }));
    if (nCancelled) foot.push(t("t_foot_cancelled", { n: nCancelled }));
    $("deals-foot").textContent = foot.join(state.lang === "zh" ? "；" : " · ");
    $("csv").textContent = t("csv", { n: state.visible.length });
    checkTableOverflow();
  }
  function checkTableOverflow() {
    var tv = $("table-view");
    tv.classList.toggle("is-overflow", !tv.hidden && tv.scrollWidth > tv.clientWidth + 1);
  }

  /* a cell that starts like a formula (= + - @, or a tab / CR) is prefixed with an apostrophe so a spreadsheet
     shows it as text instead of evaluating it (titles and amount_text come from news and curation) */
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function downloadCSV() {
    var cols = ["id", "announced", "kind", "subkind", "from", "from_name", "to", "to_name", "amount_usd", "amount_text", "status", "confidence", "origin", "title_en", "title_zh", "sources", "source_urls"];
    var lines = [cols.join(",")];
    sortedVisible().forEach(function (e) {
      var a = state.ents.get(e.from), b = state.ents.get(e.to);
      var row = [e.id, e.announced, e.kind, e.subkind, e.from, state.lang === "zh" ? a.name_zh : a.name, e.to, state.lang === "zh" ? b.name_zh : b.name,
        e.amount_usd, e.amount_text, e.status, e.confidence, e.origin, e.title_en, e.title_zh,
        e.sources.map(function (s) { return s.publisher || hostOf(s.url) || ""; }).join("; "),
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

  /* ---------- circular deals: panel and view ---------- */
  function loopLabel(lp) {
    return lp.entities.map(entName).join(" → ") + " → " + entName(lp.entities[0]);
  }
  function legRow(leg) {
    var es = leg.edge_ids.map(function (id) { return state.edgeById.get(id); }).filter(Boolean);
    var vis = es.filter(function (e) { return edgeVisible(e); });
    var kinds = leg.kinds.map(function (k) { return I.kind(state.lang, k); }).join(state.lang === "zh" ? "、" : ", ");
    var li = h("li", { class: "leg" }, [
      h("span", { class: "leg__who" }, [entButton(leg.from, "prow__who"), h("span", { class: "leg__arr", "aria-hidden": "true", text: "→" }), entButton(leg.to, "prow__who")]),
      h("span", { class: "leg__amt", text: leg.usd ? usd(leg.usd) : t("undisclosed") }),
      h("span", { class: "leg__m" }, [
        h("span", { class: "key", style: "--c:" + kindColor(leg.kinds[0] || "other"), "aria-hidden": "true" }), kinds,
        h("span", { class: "d", text: " · " + t("t_count", { n: es.length }) })
      ])
    ]);
    var ul = h("ul", { class: "plist plist--sub" });
    vis.sort(function (a, b) { return (b.amount_usd || 0) - (a.amount_usd || 0); }).forEach(function (e) { ul.appendChild(dealRow(e, e.to)); });
    li.appendChild(ul);
    return li;
  }
  function renderLoopPanel(p, lp) {
    p.appendChild(h("div", { class: "panel__head" }, [
      h("div", { class: "panel__head-main" }, [
        h("div", { class: "panel__eyebrow" }, [h("span", { class: "tag", text: t(lp.entities.length === 2 ? "loop_pair" : "loop_three") })]),
        panelTitle(loopLabel(lp)),
        h("div", { class: "panel__meta", text: [t("loop_n_legs", { n: lp.legs.length }), lp.min_usd ? t("loop_min", { v: usd(lp.min_usd) }) : null, lp.max_usd ? t("loop_max", { v: usd(lp.max_usd) }) : null].filter(Boolean).join(" · ") })
      ]),
      closeBtn()
    ]));
    var body = h("div", { class: "panel__body" });
    body.appendChild(h("p", { class: "panel__hint", text: t("loop_hint") }));
    var ol = h("ol", { class: "legs" });
    lp.legs.forEach(function (leg) { ol.appendChild(legRow(leg)); });
    body.appendChild(ol);
    p.appendChild(body);
  }

  function renderLoops() {
    var list = $("loops-list"), empty = $("loops-empty");
    list.textContent = "";
    $("loops-hint").textContent = t("loops_hint");
    var loops = state.visibleLoops;
    empty.hidden = !!loops.length || !state.raw;
    empty.textContent = loops.length ? "" : t("loops_empty");
    var max = loops.reduce(function (m, lp) { return Math.max(m, lp.max_usd || 0); }, 0) || 1;
    loops.forEach(function (lp, i) {
      var selected = state.sel && state.sel.type === "loop" && state.sel.id === lp.key;
      var btn = h("button", {
        type: "button", class: "loop-row" + (selected ? " is-sel" : ""), "aria-pressed": String(!!selected),
        onclick: function (ev) {
          /* the map first, so the phone sheet opens over the graph and the legs are lifted there */
          setView("graph");
          select({ type: "loop", id: lp.key }, { kbd: ev.detail === 0 });
          if (mq("(min-width: 1081px)").matches) $("workspace").scrollIntoView({ block: "start", behavior: RM.matches ? "auto" : "smooth" });
        }
      }, [
        h("span", { class: "loop-row__n", text: String(i + 1) }),
        h("span", { class: "loop-row__main" }, [
          h("span", { class: "loop-row__who", text: loopLabel(lp) }),
          h("span", { class: "loop-row__legs" }, lp.legs.map(function (leg) {
            return h("span", { class: "loop-row__leg" }, [
              h("span", { class: "key", style: "--c:" + kindColor(leg.kinds[0] || "other"), "aria-hidden": "true" }),
              leg.kinds.map(function (k) { return I.kind(state.lang, k); }).join("/") + " " + (leg.usd ? usd(leg.usd) : t("undisclosed"))
            ]);
          }))
        ]),
        h("span", { class: "loop-row__v" }, [
          h("b", { text: lp.min_usd ? usd(lp.min_usd) : t("undisclosed") }),
          h("small", { text: lp.min_usd ? t("loop_min", { v: "" }).trim() : t("loop_min", { v: t("undisclosed") }) }),
          h("span", { class: "loop-row__bar", "aria-hidden": "true" }, [h("i", { style: "width:" + Math.max(1, (lp.min_usd || 0) / max * 100).toFixed(1) + "%" })])
        ])
      ]);
      list.appendChild(h("li", {}, [btn]));
    });
  }

  /* ---------- change log ---------- */
  function fieldLabel(f) {
    var map = { amount_usd: "t_amount", amount_text: "f_amount_text", status: "t_status", confidence: "t_confidence", announced: "p_announced", subkind: "p_subkind",
      subkind_zh: "p_subkind", term: "p_term", term_zh: "p_term", sources: "p_sources", title_en: "t_deal", title_zh: "t_deal", summary_en: "f_summary", summary_zh: "f_summary",
      from: "t_from", to: "t_to", kind: "t_kind" };
    var lang = /_(en|zh)$/.exec(f);
    return (map[f] ? t(map[f]) : f) + (lang ? " (" + t("tag_" + lang[1]) + ")" : "");
  }
  function fieldValue(f, v) {
    if (v == null || v === "") return "–";
    if (f === "amount_usd" && typeof v === "number") return usd(v);
    if (f === "status") return I.status(state.lang, v);
    if (f === "confidence") return I.confidence(state.lang, v);
    if (typeof v === "object") return Array.isArray(v) ? String(v.length) : JSON.stringify(v);
    var s = String(v);
    return s.length > 80 ? s.slice(0, 77) + "…" : s;
  }
  function renderChanges() {
    var list = $("changes-list"), empty = $("changes-empty"), hint = $("changes-hint");
    list.textContent = "";
    var all = state.changes || [];
    var rows = all.slice().sort(function (a, b) { return String(b.date || "") < String(a.date || "") ? -1 : 1; }).slice(0, CHANGES_MAX);
    empty.hidden = !!rows.length;
    empty.textContent = rows.length ? "" : (state.changesState === "loading" ? t("loading") : t("changes_none"));
    if (!rows.length) { hint.textContent = ""; return; }
    var n = { added: 0, removed: 0, changed: 0 };
    rows.forEach(function (c) { if (c.kind in n) n[c.kind]++; });
    hint.textContent = t("changes_hint", { n: rows.length, added: n.added, removed: n.removed, changed: n.changed });
    var zh = state.lang === "zh";
    rows.forEach(function (c) {
      var title = (zh ? c.title_zh : c.title_en) || c.title_en || c.title_zh || c.edge || "";
      var e = c.edge ? state.edgeById.get(c.edge) : null;
      var fields = c.fields && typeof c.fields === "object" ? Object.keys(c.fields) : [];
      var kindKey = { added: "ch_added", removed: "ch_removed", changed: "ch_changed" }[c.kind] || "ch_changed";
      list.appendChild(h("li", { class: "chg chg--" + (c.kind || "changed") }, [
        h("span", { class: "chg__m" }, [
          h("span", { class: "chg__d", text: dayMeta(c.date) }),
          h("span", { class: "chg__k", text: t(kindKey) }),
          c.commit ? h("span", { class: "chg__c", text: t("ch_commit", { c: String(c.commit).slice(0, 7) }) }) : null
        ]),
        e ? h("button", { type: "button", class: "chg__t", lang: zh && !c.title_zh ? "en" : null, onclick: picker({ type: "edge", id: c.edge }), text: title })
          : h("span", { class: "chg__t chg__t--gone", lang: zh && !c.title_zh ? "en" : null, text: title }),
        fields.length ? h("ul", { class: "chg__fields" }, fields.map(function (f) {
          var d = c.fields[f] || {};
          return h("li", {}, [h("span", { class: "chg__f", text: fieldLabel(f) }), " ", h("span", { class: "chg__from", text: fieldValue(f, d.from) }), h("span", { class: "chg__arr", "aria-hidden": "true", text: " → " }), h("span", { class: "chg__to", text: fieldValue(f, d.to) })]);
        })) : null
      ]));
    });
  }

  /* ---------- timeline strip ---------- */
  /* stats.timeline drawn as two small panels on one month axis: columns for each month's counted amount (stacked
     by colour class) and a line for the cumulative total, with a brush that sets the period filter */
  var TL = { brushing: false };
  function monthLabel(ym, short) {
    var d = I.parseISO(ym + "-01");
    if (!d) return ym;
    try {
      return new Intl.DateTimeFormat(state.lang === "zh" ? "zh-CN" : "en-US", short ? { month: "short", timeZone: "UTC" } : { year: "numeric", month: "short", timeZone: "UTC" }).format(d);
    } catch (e) { return ym; }
  }
  function monthEnd(ym) {
    var p = ym.split("-"), y = Number(p[0]), m = Number(p[1]);
    return isoDay(new Date(Date.UTC(y, m, 0)));
  }
  function renderTimeline(full) {
    var sec = $("timeline"), rows = state.timeline;
    if (!rows || rows.length < 2 || !window.d3) { sec.hidden = true; return; }
    sec.hidden = false;
    var svg = d3.select("#tl-svg");
    var W = sec.clientWidth || 800, narrow = W < 600;
    var M = { l: 4, r: narrow ? 52 : 64, t: 6, b: 18 }, H1 = narrow ? 54 : 64, H2 = narrow ? 30 : 36, gap = 8;
    var H = M.t + H1 + gap + H2 + M.b;
    svg.attr("viewBox", "0 0 " + W + " " + H).attr("width", W).attr("height", H);
    var changed = full || TL.w !== W || TL.n !== rows.length;
    var x = d3.scaleBand().domain(rows.map(function (r) { return r.month; })).range([M.l, W - M.r]).paddingInner(0.25);
    var y1 = d3.scaleLinear().domain([0, d3.max(rows, function (r) { return r.usd; }) || 1]).nice().range([M.t + H1, M.t]);
    var y2 = d3.scaleLinear().domain([0, d3.max(rows, function (r) { return r.cumulative_usd; }) || 1]).range([M.t + H1 + gap + H2, M.t + H1 + gap]);
    TL.x = x; TL.w = W; TL.n = rows.length;
    if (changed) {
      svg.selectAll("*").remove();
      svg.attr("aria-label", t("tl_aria", { a: monthLabel(rows[0].month), b: monthLabel(rows[rows.length - 1].month) }));
      var g = svg.append("g").attr("class", "tl");
      /* gridlines and right-hand ticks for the monthly panel */
      var ticks = y1.ticks(2);
      g.append("g").attr("class", "tl__grid").selectAll("line").data(ticks).enter().append("line")
        .attr("x1", M.l).attr("x2", W - M.r).attr("y1", y1).attr("y2", y1);
      g.append("g").attr("class", "tl__ticks").selectAll("text").data(ticks).enter().append("text")
        .attr("x", W - M.r + 6).attr("y", function (d) { return y1(d) + 4; }).text(function (d) { return d ? usd(d) : "0"; });
      /* columns stacked by colour class, square at the baseline, a 2px surface gap between segments */
      var cols = g.append("g").attr("class", "tl__cols").selectAll("g").data(rows).enter().append("g")
        .attr("transform", function (r) { return "translate(" + x(r.month) + ",0)"; });
      cols.each(function (r) {
        var cg = d3.select(this), yy = y1(0);
        var bc = {};
        Object.keys(r.by_kind || {}).forEach(function (k) { var c = classOf(k); bc[c] = (bc[c] || 0) + (r.by_kind[k] || 0); });
        CLASSES.forEach(function (c) {
          var v = bc[c];
          if (!v) return;
          var top = y1(y1.invert(yy) + v);
          var hgt = Math.max(0, yy - top - (yy === y1(0) ? 0 : 2));
          cg.append("rect").attr("class", "tl__seg").attr("x", 0).attr("width", Math.max(2, Math.min(24, x.bandwidth())))
            .attr("y", top).attr("height", hgt).style("fill", classColor(c));
          yy = top;
        });
      });
      /* cumulative line with an end marker and the end value */
      var line = d3.line().x(function (r) { return x(r.month) + x.bandwidth() / 2; }).y(function (r) { return y2(r.cumulative_usd); });
      g.append("path").attr("class", "tl__cum").attr("d", line(rows));
      var last = rows[rows.length - 1];
      g.append("circle").attr("class", "tl__dot").attr("r", 4).attr("cx", x(last.month) + x.bandwidth() / 2).attr("cy", y2(last.cumulative_usd));
      g.append("text").attr("class", "tl__ticks tl__end").attr("x", W - M.r + 6).attr("y", y2(last.cumulative_usd) + 4).text(usd(last.cumulative_usd));
      g.append("text").attr("class", "tl__panel").attr("x", M.l).attr("y", M.t + H1 + gap + 10).text(t("tl_cumulative"));
      /* month axis: a label every N months so they never collide */
      var every = Math.max(1, Math.ceil(rows.length / Math.floor((W - M.l - M.r) / (narrow ? 56 : 72))));
      g.append("g").attr("class", "tl__axis").selectAll("text").data(rows.filter(function (r, i) { return i % every === 0; })).enter().append("text")
        .attr("x", function (r) { return x(r.month) + x.bandwidth() / 2; }).attr("y", H - 4).attr("text-anchor", "middle")
        .text(function (r, i) { return every >= 12 || r.month.slice(5) === "01" || i === 0 ? monthLabel(r.month) : monthLabel(r.month, true); });
      /* hover: one tooltip per month across both panels (the brush overlay sits on top, so the pointer is read
         on the brush group and mapped back to a month) */
      var byMonth = new Map(rows.map(function (r) { return [r.month, r]; }));
      function tlTip(ev) {
        if (ev.pointerType === "touch" || TL.brushing) { hideTip(); return; }
        var r = byMonth.get(monthAt(d3.pointer(ev, svg.node())[0]));
        if (!r) { hideTip(); return; }
        var tip = G.tip;
        tip.textContent = "";
        tip.appendChild(h("span", { class: "tooltip__v", text: usdSum(r.usd, r.count) }));
        tip.appendChild(h("span", { class: "tooltip__t", text: monthLabel(r.month) + " · " + t("t_count", { n: r.count }) }));
        tip.appendChild(h("span", { class: "tooltip__m", text: t("tl_cumulative") + " " + usd(r.cumulative_usd) }));
        tip.hidden = false;
        placeTipIn(ev, sec);
      }
      /* the brush: dragging across months sets a custom period; the handles snap to month edges */
      TL.brush = d3.brushX().extent([[M.l, M.t], [W - M.r, M.t + H1 + gap + H2]])
        .on("start", function () { TL.brushing = true; hideTip(); })
        .on("end", function (ev) {
          TL.brushing = false;
          if (!ev.sourceEvent) return;   /* programmatic moves (syncBrush) do not re-filter */
          if (!ev.selection) { if (state.filters.period === "custom") { setPeriod("all"); renderAll(false, false, true); } return; }
          var r0 = monthAt(ev.selection[0]), r1 = monthAt(ev.selection[1] - 1);
          var f = state.filters;
          f.period = "custom"; f.from = r0 + "-01"; f.to = monthEnd(r1);
          $("f-period").value = "custom"; $("f-from").value = f.from; $("f-to").value = f.to;
          renderAll(false, false, true);
        });
      TL.brushG = g.append("g").attr("class", "tl__brush").call(TL.brush)
        .on("pointermove", tlTip).on("pointerleave", hideTip);
      TL.brushG.select(".overlay").attr("aria-hidden", "true");
    }
    syncBrush();
  }
  function monthAt(px) {
    var x = TL.x, dom = x.domain();
    var i = Math.max(0, Math.min(dom.length - 1, Math.floor((px - x.range()[0]) / x.step())));
    return dom[i];
  }
  /* keep the brush and the "Showing a – b" line on the period filter (set from the select, a pill, the dates or the brush) */
  function syncBrush() {
    if (!TL.brushG) return;
    var f = state.filters, x = TL.x, dom = x.domain();
    var rng = $("tl-range"), clear = $("tl-clear");
    if (!f.from && !f.to) {
      if (!TL.brushing) TL.brushG.call(TL.brush.move, null);
      rng.textContent = ""; clear.hidden = true;
      return;
    }
    var a = (f.from || dom[0]).slice(0, 7), b = (f.to || dom[dom.length - 1]).slice(0, 7);
    var ia = dom.indexOf(a), ib = dom.indexOf(b);
    if (ia < 0) ia = a < dom[0] ? 0 : dom.length - 1;
    if (ib < 0) ib = b > dom[dom.length - 1] ? dom.length - 1 : 0;
    if (ib < ia) ib = ia;
    if (!TL.brushing) TL.brushG.call(TL.brush.move, [x(dom[ia]), x(dom[ib]) + x.bandwidth()]);
    rng.textContent = t("tl_range", { a: f.from ? day(f.from) : monthLabel(dom[0]), b: f.to ? day(f.to) : monthLabel(dom[dom.length - 1]) });
    clear.hidden = false;
  }
  function placeTipIn(ev, box) {
    var r = box.getBoundingClientRect(), tip = G.tip;
    var x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 14;
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    if (x + tw > r.width - 8) x = Math.max(8, ev.clientX - r.left - tw - 14);
    if (y + th > r.height - 8) y = Math.max(8, ev.clientY - r.top - th - 14);
    if (tip.parentNode !== box) box.appendChild(tip);
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }

  /* ---------- latest feed ---------- */
  function sortByDate(arr, key) {
    return arr.slice().sort(function (a, b) {
      var x = I.parseISO(a[key]), y = I.parseISO(b[key]);
      return (y ? y.getTime() : 0) - (x ? x.getTime() : 0);
    });
  }
  function feedEnt(id) {
    return h("button", {
      type: "button", class: "ent", text: shortName(id), title: t("p_select_from", { name: entName(id) }),
      onclick: function (ev) {
        select({ type: "node", id: id }, { kbd: ev.detail === 0 });
        if (state.view !== "graph") return;
        /* on a wide screen the map and panel sit above the feed: bring them back into view */
        var ws = $("workspace");
        if (mq("(min-width: 1081px)").matches && ws.getBoundingClientRect().bottom < 120) {
          ws.scrollIntoView({ block: "start", behavior: RM.matches ? "auto" : "smooth" });
        }
        zoomToNode(id);
      }
    });
  }
  function entTags(ids) {
    var out = ids.slice(0, 2).map(feedEnt);
    if (ids.length > 2) out.push(h("span", { class: "ent-more", text: "+" + (ids.length - 2) }));
    return out;
  }
  /* a small tag when a headline is not in the page language */
  function langTag(text) {
    var sc = scriptOf(text);
    if (sc === state.lang) return null;
    return h("span", { class: "xtag", text: t("tag_" + sc) });
  }
  function renderFeeds() {
    var raw = state.raw || {};
    var news = Array.isArray(raw.news) ? raw.news : [];
    var filings = Array.isArray(raw.filings) ? raw.filings : [];
    var zh = state.lang === "zh";
    var nl = $("feed-news");
    nl.textContent = "";
    if (!news.length) nl.appendChild(h("li", { class: "feed__empty", text: t("latest_none_news") }));
    sortByDate(news, "published").slice(0, 10).forEach(function (n) {
      var title = n.title || n.link;
      var pub = n.publisher || n.source;
      var ents = (n.entities || []).filter(function (id) { return state.ents.has(id); });
      nl.appendChild(h("li", {}, [
        extLink(n.link, title),
        langTag(title),
        h("span", { class: "feed__m" }, [
          h("span", { class: "d", title: n.published ? I.fmtDateTime(n.published, state.lang) : null, text: I.ago(n.published, state.lang) + (pub ? " · " + pub : "") })
        ].concat(entTags(ents)))
      ]));
    });
    var fl = $("feed-filings");
    fl.textContent = "";
    if (!filings.length) fl.appendChild(h("li", { class: "feed__empty", text: t("latest_none_filings") }));
    sortByDate(filings, "filed").slice(0, 10).forEach(function (f) {
      var items = Array.isArray(f.items) ? f.items.join(zh ? "、" : ", ") : (f.items || "");
      var title = (zh ? f.title_zh : f.title_en) || f.title_en || f.title || (entName(f.entity) + " " + (f.form || ""));
      var ent = state.ents.get(f.entity);
      var low = String(title).toLowerCase();
      var named = ent && [ent.name, ent.name_zh, shortName(f.entity)].some(function (nm) { return nm && low.indexOf(String(nm).toLowerCase()) >= 0; });
      fl.appendChild(h("li", {}, [
        extLink(f.url || f.index_url, title),
        h("span", { class: "feed__m" }, [
          h("span", { class: "form-tag", text: f.form || "" }),
          items ? h("span", { text: t("filing_items", { items: items }) }) : null,
          h("span", { class: "d", text: dayMeta(f.filed) }),
          ent && !named ? feedEnt(f.entity) : null
        ])
      ]));
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    if (mq("(max-width: 760px)").matches) $("legend").open = false;
    applyStatic();
    wireControls();
    setupGraph();
    setView("graph");
    load();
    if (!SNAPSHOT) setInterval(load, REFRESH_MS);
    window.AOD = { reload: load, state: state };
    setInterval(renderLive, 30 * 1000);
    /* the 761-1080px drawer starts below the masthead while it is on screen, so the
       language toggle and live status stay reachable with a panel open */
    var dtRaf = 0, mast = document.querySelector(".masthead");
    function drawerTop() {
      dtRaf = 0;
      if (!mast) return;
      var b = Math.max(0, Math.round(mast.getBoundingClientRect().bottom));
      document.documentElement.style.setProperty("--drawer-top", b + "px");
    }
    function queueDrawerTop() { if (!dtRaf) dtRaf = requestAnimationFrame(drawerTop); }
    window.addEventListener("scroll", queueDrawerTop, { passive: true });
    window.addEventListener("resize", queueDrawerTop);
    if (mast && window.ResizeObserver) new ResizeObserver(queueDrawerTop).observe(mast);
    drawerTop();
    var rt;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        var gv = $("graph-view");
        if (gv.clientWidth) { G.width = gv.clientWidth; G.height = gv.clientHeight; }
        if (state.view === "table") checkTableOverflow();
        if (state.raw) renderTimeline(true);
        /* the sheet handle exists only at <=1080px: re-render only when crossing that width */
        var p = $("panel");
        if (state.raw && p.classList.contains("is-open") && !!p.querySelector(".panel__grab") !== mq("(max-width: 1080px)").matches) renderPanel();
      }, 200);
    });
  }

  /* no d3 (the vendored file and the CDN fallback both failed): the static text still follows the language and
     the banner says what happened; Retry reloads the page */
  if (!window.d3) {
    document.addEventListener("DOMContentLoaded", function () {
      applyStatic();
      $("lang-en").addEventListener("click", function () { state.lang = "en"; store.set(LS_LANG, "en"); applyStatic(); });
      $("lang-zh").addEventListener("click", function () { state.lang = "zh"; store.set(LS_LANG, "zh"); applyStatic(); });
      showError("script");
      $("retry").addEventListener("click", function () { location.reload(); });
      $("graph-loading").hidden = true;
    });
    return;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
