/* Static chart output from bounded JSON data. No scripts or remote chart runtime. */
(() => {
  "use strict";
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const text = (value, max = 1000) => typeof value === "string" && value.length <= max;
  const key = value => text(value, 128) && value.length > 0 && !["__proto__", "prototype", "constructor"].includes(value);
  const colors = ["#377eb8", "#d17c27", "#29836b", "#8059a3", "#b74d67", "#6b7075"];

  function render(source, inline = false) {
    if (typeof source !== "string" || source.length > 100000) return null;
    let chart;
    try { chart = JSON.parse(source); } catch (_) { return null; }
    if (!chart || !key(chart.xKey) || !Array.isArray(chart.series) || !chart.series.length || chart.series.length > 12 ||
        !Array.isArray(chart.data) || !chart.data.length || chart.data.length > 200) return null;
    if (!chart.series.every(series => series && key(series.dataKey) && text(series.label) &&
        (series.valuePrefix === undefined || text(series.valuePrefix, 80)) &&
        (series.valueSuffix === undefined || text(series.valueSuffix, 80)))) return null;
    if (!chart.data.every(row => row && Object.hasOwn(row, chart.xKey) &&
        (text(row[chart.xKey]) || typeof row[chart.xKey] === "number" && Number.isFinite(row[chart.xKey])) &&
        chart.series.every(series => Object.hasOwn(row, series.dataKey) && typeof row[series.dataKey] === "number" &&
          Number.isFinite(row[series.dataKey]) && Math.abs(row[series.dataKey]) <= 1e15))) return null;
    const title = text(chart.meta?.title) ? chart.meta.title : "";
    const description = text(chart.meta?.description, 2000) ? chart.meta.description : "";
    const value = (row, series) => escape(`${series.valuePrefix || ""}${row[series.dataKey]}${series.valueSuffix || ""}`);
    const maximum = Math.max(0, ...chart.data.flatMap(row => chart.series.map(series => row[series.dataKey])));
    const bars = chart.chartType === "bar" && chart.data.every(row => chart.series.every(series => row[series.dataKey] >= 0));
    const tag = inline ? "span" : "figure", block = inline ? "span" : "div";
    let html = `<${tag} class="archive-chart">`;
    if (title) html += `<${inline ? "span" : "figcaption"} class="archive-chart-title">${escape(title)}</${inline ? "span" : "figcaption"}>`;
    if (description) html += `<${block} class="archive-chart-description">${escape(description)}</${block}>`;
    if (bars) {
      for (const row of chart.data) {
        html += `<${block} class="archive-chart-group"><${block} class="archive-chart-category">${escape(row[chart.xKey])}</${block}>`;
        for (const [index, series] of chart.series.entries()) {
          const width = maximum ? (row[series.dataKey] / maximum * 100).toFixed(4) : "0";
          html += `<${block} class="archive-chart-row"><span class="archive-chart-label">${escape(series.label)}</span>` +
            `<span class="archive-chart-track" aria-hidden="true"><span class="archive-chart-bar" style="width:${width}%;background-color:${colors[index % colors.length]}"></span></span>` +
            `<span class="archive-chart-value">${value(row, series)}</span></${block}>`;
        }
        html += `</${block}>`;
      }
    } else {
      // Other chart types and negative values retain their exact data as a table.
      const table = inline ? "span" : "table", tr = inline ? "span" : "tr", td = inline ? "span" : "td", th = inline ? "span" : "th";
      const cell = (tag, role, content) => `<${tag}${inline ? ` role="${role}"` : ""}>${content}</${tag}>`;
      html += `<${table} class="archive-chart-table"${inline ? ' role="table"' : ""}>`;
      if (!inline) html += "<thead>";
      html += `<${tr}${inline ? ' role="row"' : ""}>${cell(th, "columnheader", escape(chart.xKey))}` +
        chart.series.map(series => cell(th, "columnheader", escape(series.label))).join("") + `</${tr}>`;
      if (!inline) html += "</thead><tbody>";
      for (const row of chart.data) html += `<${tr}${inline ? ' role="row"' : ""}>${cell(td, "cell", escape(row[chart.xKey]))}` +
        chart.series.map(series => cell(td, "cell", value(row, series))).join("") + `</${tr}>`;
      if (!inline) html += "</tbody>";
      html += `</${table}>`;
    }
    return html + `</${tag}>`;
  }
  globalThis.ChatGPTArchiveCharts = { render };
})();
