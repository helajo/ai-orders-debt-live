/* AI orders & debt map: strings and formatters for English / 中文.
   Loaded before app.js; exposes window.I18N. */
(function () {
  "use strict";

  var STR = {
    en: {
      doc_title: "AI Orders & Debt Map",
      brand: "AI Orders & Debt Map",
      brand_sub: "Who owes whom among the AI giants: orders, investments and debt, monitored by Claude",
      live: "Live",
      stale: "Stale",
      sample: "Sample",
      snapshot: "Snapshot",
      snapshot_banner: "Archived snapshot of {d}. This view does not refresh.",
      snapshot_back: "Back to the live map",
      src_sec: "SEC EDGAR",
      src_news: "News feeds",
      src_fail: "{s}: last fetch failed",
      offline: "Offline",
      updated: "Graph built {t}",
      monitor_ran: "monitor ran {t}",
      monitor_never: "monitor has not run yet",
      monitor_counts: "{sec} SEC filings · {news} news items · {cand} candidates",
      claude_on: "Claude extraction on",
      claude_off: "Claude extraction off",
      next_check: "checks again every 5 min",
      refreshing: "Refreshing…",
      load_error: "Could not load any data. Serve the project folder and open /site/, or check that data/graph.json exists.",

      sum_orders: "Orders",
      sum_investments: "Investments",
      sum_debt: "Debt",
      sum_deals: "Deals",
      sum_entities: "Companies",
      sum_scope_all: "all deals",
      sum_scope_filtered: "in current filter",
      sum_undisclosed: "{n} undisclosed",

      f_kinds: "Deal type",
      f_group: "Sector",
      f_group_all: "All sectors",
      f_min: "Minimum size",
      f_min_any: "Any size",
      f_from: "From",
      f_to: "To",
      f_period: "Period",
      f_period_all: "All dates",
      f_period_365: "Last 12 months",
      f_period_90: "Last 90 days",
      f_period_2026: "2026",
      f_period_2025: "2025",
      f_period_custom: "Custom",
      f_unverified: "Show unverified (not yet checked)",
      f_search: "Search",
      f_search_ph: "Company, ticker or deal…",
      f_reset: "Reset filters",
      f_more: "More filters",
      f_active: "{n} active",

      view_graph: "Graph",
      view_table: "Table",
      zoom_in: "Zoom in",
      zoom_out: "Zoom out",
      zoom_fit: "Fit to view",
      legend_size: "Circle size = total money in and out",
      legend_width: "Line width = deal size",
      legend_dashed: "Dashed = unverified",
      legend_arrow: "Arrow = direction money flows",
      graph_empty: "No deals match these filters.",
      graph_hint: "Drag to pan, scroll or pinch to zoom. Select a company or a line for details.",

      t_date: "Date",
      t_kind: "Type",
      t_from: "From",
      t_to: "To",
      t_deal: "Deal",
      t_amount: "Amount",
      t_status: "Status",
      t_confidence: "Confidence",
      t_sources: "Sources",
      csv: "Download CSV",
      t_count: "{n} deals",

      panel_overview: "Largest exposures",
      panel_overview_hint: "Select a company in the graph to see who it owes, who owes it, and every order and investment.",
      panel_close: "Close",
      p_total_in: "Money in",
      p_total_out: "Money out",
      p_deals: "Deals",
      p_owes: "Owes (borrowed from)",
      p_owed: "Is owed (lent to)",
      p_orders_placed: "Orders placed",
      p_orders_received: "Orders received",
      p_invest_made: "Investments made",
      p_invest_received: "Investments received",
      p_leases_paid: "Leases (pays rent to)",
      p_leases_received: "Leases (collects rent from)",
      p_vf_given: "Vendor financing given",
      p_vf_received: "Vendor financing received",
      p_guar_given: "Guarantees given",
      p_guar_received: "Guarantees received",
      p_none: "No deals in the current filter.",
      p_flow: "Money flows",
      p_subkind: "Instrument",
      p_term: "Term",
      p_announced: "Announced",
      p_amount_note: "As reported",
      p_sources: "Sources",
      p_origin_candidate: "Machine-extracted by the monitor and not yet checked by a person.",
      p_select_from: "Show {name}",
      p_new: "New",
      p_bundle: "{n} deals",
      p_bundle_hint: "Deals of the same type between the same two companies are drawn as one line; its width is their total.",

      latest: "Latest from the monitor",
      latest_news: "News",
      latest_filings: "SEC filings",
      latest_none_news: "No news items yet. The monitor adds them on its next run.",
      latest_none_filings: "No filings yet. The monitor adds 8-K and 10-Q items on its next run.",
      filing_items: "Item {items}",

      new_edges: "{n} new deals since last check",
      new_edges_one: "1 new deal since last check",

      footer_disclaimer: "Descriptive only, not investment advice. Figures are nominal USD as reported by companies and named outlets; every deal links to its sources. Dashed lines are unverified: found by a model or research search and not yet checked against their sources, so they may be wrong; the daily check confirms or removes them.",
      footer_built: "Built from public filings and news. Monitor runs on a schedule; this page re-checks every 5 minutes.",
      ago_now: "just now",
      ago_min: "{n} min ago",
      ago_hour: "{n} h ago",
      ago_day: "{n} d ago",
      never: "not yet",
      undisclosed: "Undisclosed",
      lang_label: "Language"
    },

    zh: {
      doc_title: "AI 巨头订单与债务关系图",
      brand: "AI 巨头订单与债务关系图",
      brand_sub: "AI 巨头之间谁欠谁：订单、投资与债务，由 Claude 持续监控",
      live: "实时",
      stale: "数据较旧",
      sample: "示例",
      snapshot: "历史快照",
      snapshot_banner: "这是 {d} 的存档快照，不会自动刷新。",
      snapshot_back: "返回实时关系图",
      src_sec: "SEC EDGAR",
      src_news: "新闻源",
      src_fail: "{s}：上次抓取失败",
      offline: "离线",
      updated: "关系图 {t}更新",
      monitor_ran: "监控 {t}运行",
      monitor_never: "监控尚未运行",
      monitor_counts: "SEC 文件 {sec} 份 · 新闻 {news} 条 · 待核实 {cand} 条",
      claude_on: "Claude 抽取已开启",
      claude_off: "Claude 抽取未开启",
      next_check: "每 5 分钟自动检查",
      refreshing: "正在刷新…",
      load_error: "无法加载数据。请在项目根目录启动本地服务器并打开 /site/，或确认 data/graph.json 存在。",

      sum_orders: "订单",
      sum_investments: "投资",
      sum_debt: "债务",
      sum_deals: "交易数",
      sum_entities: "公司数",
      sum_scope_all: "全部交易",
      sum_scope_filtered: "当前筛选",
      sum_undisclosed: "{n} 笔未披露金额",

      f_kinds: "交易类型",
      f_group: "行业",
      f_group_all: "全部行业",
      f_min: "最低金额",
      f_min_any: "不限金额",
      f_from: "起",
      f_to: "止",
      f_period: "时间",
      f_period_all: "全部时间",
      f_period_365: "近 12 个月",
      f_period_90: "近 90 天",
      f_period_2026: "2026 年",
      f_period_2025: "2025 年",
      f_period_custom: "自定义",
      f_unverified: "显示未核实（尚未核查）",
      f_search: "搜索",
      f_search_ph: "公司、股票代码或交易…",
      f_reset: "重置筛选",
      f_more: "更多筛选",
      f_active: "已启用 {n} 项",

      view_graph: "关系图",
      view_table: "表格",
      zoom_in: "放大",
      zoom_out: "缩小",
      zoom_fit: "适应窗口",
      legend_size: "圆圈大小 = 资金流入与流出总额",
      legend_width: "线条粗细 = 交易金额",
      legend_dashed: "虚线 = 未核实",
      legend_arrow: "箭头 = 资金流向",
      graph_empty: "没有符合筛选条件的交易。",
      graph_hint: "拖动平移，滚轮或双指缩放。点击公司或连线查看详情。",

      t_date: "日期",
      t_kind: "类型",
      t_from: "出资方",
      t_to: "收款方",
      t_deal: "交易",
      t_amount: "金额",
      t_status: "状态",
      t_confidence: "可信度",
      t_sources: "来源",
      csv: "下载 CSV",
      t_count: "{n} 笔交易",

      panel_overview: "资金往来最大的公司",
      panel_overview_hint: "在关系图中点击一家公司，查看它欠谁、谁欠它，以及全部订单与投资。",
      panel_close: "关闭",
      p_total_in: "资金流入",
      p_total_out: "资金流出",
      p_deals: "交易",
      p_owes: "借款（欠谁）",
      p_owed: "放款（谁欠它）",
      p_orders_placed: "发出的订单",
      p_orders_received: "收到的订单",
      p_invest_made: "对外投资",
      p_invest_received: "获得投资",
      p_leases_paid: "租入（向对方付租金）",
      p_leases_received: "租出（向对方收租金）",
      p_vf_given: "提供的供应商融资",
      p_vf_received: "获得的供应商融资",
      p_guar_given: "提供的担保",
      p_guar_received: "获得的担保",
      p_none: "当前筛选下没有交易。",
      p_flow: "资金流向",
      p_subkind: "交易形式",
      p_term: "期限",
      p_announced: "公布日期",
      p_amount_note: "原始表述（英文）",
      p_sources: "来源",
      p_origin_candidate: "由监控程序自动抽取，尚未经人工核实。",
      p_select_from: "查看{name}",
      p_new: "新",
      p_bundle: "{n} 笔交易",
      p_bundle_hint: "同一对公司之间同类型的多笔交易合并为一条线，线宽代表合计金额。",

      latest: "监控最新动态",
      latest_news: "新闻",
      latest_filings: "SEC 文件",
      latest_none_news: "暂无新闻。监控下次运行时会添加。",
      latest_none_filings: "暂无文件。监控下次运行时会添加 8-K 与 10-Q 条目。",
      filing_items: "第 {items} 项",

      new_edges: "自上次检查以来新增 {n} 笔",
      new_edges_one: "自上次检查以来新增 1 笔",

      footer_disclaimer: "仅作描述，不构成投资建议。金额为公司或具名媒体披露的名义美元金额；每笔交易均附来源链接。虚线为未核实的信息：由模型或研究检索发现、尚未对照来源核查，可能有误；每日核查会确认或删除。",
      footer_built: "依据公开文件与新闻整理。监控程序定时运行；本页每 5 分钟自动检查更新。",
      ago_now: "刚刚",
      ago_min: "{n} 分钟前",
      ago_hour: "{n} 小时前",
      ago_day: "{n} 天前",
      never: "尚未运行",
      undisclosed: "未披露",
      lang_label: "语言"
    }
  };

  var KINDS = {
    order: { en: "Order", zh: "订单" },
    investment: { en: "Investment", zh: "投资" },
    debt: { en: "Debt", zh: "债务" },
    vendor_financing: { en: "Vendor financing", zh: "供应商融资" },
    lease: { en: "Lease", zh: "租赁" },
    guarantee: { en: "Guarantee", zh: "担保" }
  };

  var GROUPS = {
    hyperscaler: { en: "Hyperscalers", zh: "云巨头" },
    model_lab: { en: "AI labs", zh: "大模型公司" },
    chip: { en: "Chips", zh: "芯片" },
    neocloud: { en: "Neoclouds", zh: "新兴算力云" },
    datacenter: { en: "Data centres", zh: "数据中心" },
    energy: { en: "Energy", zh: "能源" },
    financier: { en: "Financiers", zh: "金融机构" },
    spv: { en: "SPVs & JVs", zh: "特殊目的实体" },
    other: { en: "Other", zh: "其他" }
  };

  var STATUS = {
    announced: { en: "Announced", zh: "已宣布" },
    signed: { en: "Signed", zh: "已签署" },
    in_progress: { en: "In progress", zh: "进行中" },
    completed: { en: "Completed", zh: "已完成" },
    cancelled: { en: "Cancelled", zh: "已取消" },
    reported: { en: "Reported", zh: "据报道" }
  };

  var CONFIDENCE = {
    confirmed: { en: "Confirmed", zh: "已确认" },
    reported: { en: "Reported", zh: "媒体报道" },
    unverified: { en: "Unverified", zh: "未核实" }
  };

  function tr(lang, key, vars) {
    var s = (STR[lang] && STR[lang][key]) || STR.en[key] || key;
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) {
        return vars[k] != null ? vars[k] : m;
      });
    }
    return s;
  }

  function label(map, lang, key) {
    var v = map[key];
    if (!v) return key ? String(key).replace(/_/g, " ") : "";
    return v[lang] || v.en;
  }

  function trimNum(x, digits) {
    var s = x.toFixed(digits);
    if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s;
  }

  /* $300B / 3000 亿美元. compact=true drops the currency word in Chinese for tight spots. */
  function fmtUSD(n, lang, opts) {
    opts = opts || {};
    if (n == null || !isFinite(n)) return tr(lang, "undisclosed");
    var a = Math.abs(n);
    if (lang === "zh") {
      var unit = opts.compact ? "" : "美元";
      if (a >= 1e12) return trimNum(n / 1e12, a >= 1e13 ? 1 : 2) + " 万亿" + unit;
      if (a >= 1e8) {
        var yi = n / 1e8;
        return (Math.abs(yi) >= 100 ? String(Math.round(yi)) : trimNum(yi, 1)) + " 亿" + unit;
      }
      if (a >= 1e4) return trimNum(n / 1e4, 0) + " 万" + unit;
      return Math.round(n) + " " + (unit || "美元");
    }
    if (a >= 1e12) return "$" + trimNum(n / 1e12, a >= 1e13 ? 1 : 2) + "T";
    if (a >= 1e9) return "$" + trimNum(n / 1e9, a >= 1e11 ? 0 : 1) + "B";
    if (a >= 1e6) return "$" + trimNum(n / 1e6, 0) + "M";
    return "$" + Math.round(n).toLocaleString("en-US");
  }

  function parseISO(s) {
    if (!s) return null;
    var d = new Date(String(s).length <= 10 ? s + "T00:00:00Z" : s);
    return isNaN(d) ? null : d;
  }

  /* ISO day -> "Sep 10, 2025" / "2025年9月10日" (UTC, so a date never shifts a day). */
  function fmtDate(s, lang, opts) {
    var d = parseISO(s);
    if (!d) return s || "";
    var o = { year: "numeric", month: opts && opts.short ? "short" : "short", day: "numeric", timeZone: "UTC" };
    if (opts && opts.noDay) delete o.day;
    try {
      return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", o).format(d);
    } catch (e) {
      return String(s).slice(0, 10);
    }
  }

  function fmtDateTime(s, lang) {
    var d = parseISO(s);
    if (!d) return s || "";
    try {
      return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
        year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short"
      }).format(d);
    } catch (e) {
      return d.toISOString();
    }
  }

  function ago(s, lang, now) {
    var d = parseISO(s);
    if (!d) return tr(lang, "never");
    var mins = Math.max(0, Math.round(((now || Date.now()) - d.getTime()) / 60000));
    if (mins < 1) return tr(lang, "ago_now");
    if (mins < 60) return tr(lang, "ago_min", { n: mins });
    var h = Math.round(mins / 60);
    if (h < 48) return tr(lang, "ago_hour", { n: h });
    return tr(lang, "ago_day", { n: Math.round(h / 24) });
  }

  window.I18N = {
    STR: STR,
    KINDS: KINDS,
    GROUPS: GROUPS,
    STATUS: STATUS,
    CONFIDENCE: CONFIDENCE,
    t: tr,
    kind: function (lang, k) { return label(KINDS, lang, k); },
    group: function (lang, g) { return label(GROUPS, lang, g); },
    status: function (lang, s) { return label(STATUS, lang, s); },
    confidence: function (lang, c) { return label(CONFIDENCE, lang, c); },
    fmtUSD: fmtUSD,
    fmtDate: fmtDate,
    fmtDateTime: fmtDateTime,
    ago: ago,
    parseISO: parseISO
  };
})();
