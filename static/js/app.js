// AgroMarket — comportamento do front (sem dependências).
(() => {
  "use strict";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n, d = 2) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

  // Versão estática (GitHub Pages): sem servidor, os dados vêm de JSON pré-gerado.
  const ROOT = document.documentElement;
  const STATIC = ROOT.hasAttribute("data-static");
  const BASE = ROOT.dataset.base || "";
  const u = (path) => BASE + path;
  const fold = (s) => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const getJSON = async (path) => { const r = await fetch(u(path)); if (!r.ok) throw new Error("Dados indisponíveis para este recorte."); return r.json(); };
  const remember = (key, value) => { try { const all = JSON.parse(localStorage.getItem(key) || "[]"); all.push(value); localStorage.setItem(key, JSON.stringify(all)); } catch { /* sem storage */ } };

  async function staticPost(url, body) {
    if ("email" in body && !EMAIL_RE.test(String(body.email).trim())) throw new Error("e-mail inválido");
    if (url === "/api/feasibility") {
      const r = await getJSON(`/api/feasibility/${body.kind}/${encodeURIComponent(body.product)}/${body.country}.json`);
      return { ...r, id: Math.floor(Date.now() / 1000) % 100000 };
    }
    if (url === "/api/newsletter") { remember("agromarket:newsletter", body); return { ok: true, following: body.products }; }
    if (url === "/api/contact") {
      if (!body.name || body.name.trim().length < 2) throw new Error("informe seu nome");
      remember("agromarket:contato", body); return { ok: true };
    }
    const deal = url.match(/^\/api\/deals\/(\d+)\/interest$/);
    if (deal) {
      remember("agromarket:interesse", { deal: deal[1], email: body.email });
      const span = document.querySelector(`[data-deal="${deal[1]}"] [data-count]`);
      return { interested: (parseInt(span?.textContent, 10) || 0) + 1 };
    }
    throw new Error("Indisponível na versão de demonstração.");
  }

  let searchIndex;
  async function staticSearch(q) {
    searchIndex ??= await getJSON("/api/search.json");
    const term = fold(q), digits = term.replace(/\./g, "");
    const ncmHit = (p) => /^\d+$/.test(digits) && p.ncm.replace(/\./g, "").startsWith(digits);
    const rank = (p) => (fold(p.name).startsWith(term) ? 0 : ncmHit(p) ? 1 : 2);
    return searchIndex
      .filter((p) => fold(p.name).includes(term) || ncmHit(p) || p.category_slug.includes(term) || fold(p.ncm_description).includes(term))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "pt-BR"))
      .slice(0, 8);
  }

  async function post(url, body) {
    if (STATIC) return staticPost(url, body);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = Array.isArray(data.detail) ? data.detail.map((d) => d.msg.replace("Value error, ", "")).join("; ") : data.detail;
      throw new Error(detail || "Não foi possível concluir. Tente de novo.");
    }
    return data;
  }

  // ---------------------------------------------------------------- menu mobile
  const toggle = $(".nav-toggle");
  toggle?.addEventListener("click", () => {
    const open = $("#main-nav").classList.toggle("open");
    toggle.setAttribute("aria-expanded", open);
  });

  // ---------------------------------------------------------------- busca com sugestões
  const box = $("[data-search]");
  if (box) {
    const input = $("input", box);
    const list = $(".suggestions", box);
    let timer, items = [], active = -1, seq = 0;

    const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
    const paint = () => $$("a", list).forEach((a, i) => a.setAttribute("aria-selected", i === active));
    const render = (q) => {
      list.innerHTML = items.length
        ? items.map((p, i) => `<li role="option"><a id="opt-${i}" href="${u(`/mercado/${esc(p.slug)}/`)}"><span>${esc(p.name)}</span><span class="s-meta">NCM ${esc(p.ncm)} · ${esc(p.category)}</span></a></li>`).join("")
        : `<li class="empty">Nada encontrado para “${esc(q)}”. Tente pelo NCM.</li>`;
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
    };
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q) return close();
      timer = setTimeout(async () => {
        const mine = ++seq;
        const found = STATIC ? await staticSearch(q) : await (await fetch(`/api/search?q=${encodeURIComponent(q)}`)).json();
        if (mine !== seq) return; // resposta atrasada de uma busca antiga
        items = found;
        active = -1;
        render(q);
      }, 160);
    });
    input.addEventListener("keydown", (e) => {
      if (list.hidden) return;
      if (e.key === "ArrowDown") { active = Math.min(active + 1, items.length - 1); paint(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { active = Math.max(active - 1, 0); paint(); e.preventDefault(); }
      else if (e.key === "Enter") {
        const target = items[active] || items[0];
        if (target) location.href = STATIC ? u(`/mercado/${target.slug}/`) : `/mercado/${target.slug}`;
        e.preventDefault();
      } else if (e.key === "Escape") close();
    });
    document.addEventListener("click", (e) => { if (!box.contains(e.target)) close(); });
  }

  // ---------------------------------------------------------------- quadro de demanda (mobile)
  $$("[data-board]").forEach((btn) => btn.addEventListener("click", () => {
    $(".board-grid").dataset.show = btn.dataset.board;
    $$("[data-board]").forEach((b) => b.setAttribute("aria-pressed", b === btn));
  }));

  // ---------------------------------------------------------------- envio automático de filtros
  // Na versão estática, os mesmos filtros rodam no navegador sobre a lista completa.
  function filterItems(form) {
    const f = Object.fromEntries(new FormData(form));
    const box = $("[data-items]");
    if (!box) return;
    const items = $$("[data-item]", box);
    const q = fold(f.q), ncm = (f.ncm || "").replace(/\./g, "");
    let shown = 0;
    for (const el of items) {
      const d = el.dataset;
      const ok = (!q || (d.name ?? d.key ?? "").includes(q))
        && (!ncm || (d.ncm || "").startsWith(ncm))
        && (!f.categoria || d.cat === f.categoria)
        && (!f.lado || d.side === f.lado)
        && (!f.papel || d.role === f.papel || d.role === "both")
        && (!f.pais || (d.countries ? d.countries.split(" ").includes(f.pais) : d.country === f.pais))
        && (!f.produto || (d.product ? d.product === f.produto : `,${d.products.trim()},`.includes(`,${f.produto},`)));
      el.hidden = !ok;
      if (ok) shown++;
    }
    if (f.ordem) {
      const sorted = [...items].sort((a, b) => f.ordem === "value" ? b.dataset.value - a.dataset.value : a.dataset.name.localeCompare(b.dataset.name));
      sorted.forEach((el) => box.appendChild(el));
    }
    const count = $("[data-count]");
    if (count) count.textContent = count.dataset.total
      ? `Total de mercados de produto: ${count.dataset.total}${shown != count.dataset.total ? ` · exibindo ${shown}` : ""}`
      : `${shown} ${count.dataset.unit}`;
    const empty = $("[data-empty]");
    if (empty) empty.hidden = shown > 0;
    const params = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && k !== "aba"));
    history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : ""));
  }

  $$("form[data-autosubmit]").forEach((form) => {
    if (STATIC) {
      const params = new URLSearchParams(location.search);
      for (const [k, v] of params) if (form.elements[k]) form.elements[k].value = v;
      form.addEventListener("submit", (e) => { e.preventDefault(); filterItems(form); });
      if (params.size) filterItems(form);
    }
    form.addEventListener("change", () => form.requestSubmit());
    $$("input[type=search]", form).forEach((i) => {
      let t;
      i.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => form.requestSubmit(), 500); });
    });
  });

  // ---------------------------------------------------------------- modais
  const openDialog = (id) => { const d = $(id); d.showModal(); return d; };
  $$("dialog").forEach((d) => {
    d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-close]")) d.close(); });
  });
  document.addEventListener("click", (e) => {
    const opener = e.target.closest("[data-open]");
    if (opener) { e.preventDefault(); openDialog(`#dlg-${opener.dataset.open}`); }
  });

  // ---------------------------------------------------------------- viabilidade
  const KIND = {
    export: { label: "Exportação · grátis · sem conta", title: "Checagem de viabilidade de exportação",
      help: "Para quem vende: quais países importadores e compradores são realistas para o seu produto.", country: "País de onde você exporta" },
    sourcing: { label: "Compra · grátis · sem conta", title: "Checagem de viabilidade de compra",
      help: "Para quem compra: quais origens e fornecedores são realistas em preço e escala.", country: "País para onde você importa" },
  };
  const feasForm = $("#feasibility-form");
  const feasReport = $("#feasibility-report");

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-feasibility]");
    if (!btn) return;
    const kind = btn.dataset.feasibility;
    const k = KIND[kind];
    const dlg = $("#dlg-feasibility");
    $("[data-kind-label]", dlg).textContent = k.label;
    $("#feas-title").textContent = k.title;
    $("[data-kind-help]", dlg).textContent = k.help;
    $("[data-country-label]", dlg).textContent = k.country;
    feasForm.kind.value = kind;
    if (btn.dataset.product) feasForm.product.value = btn.dataset.product;
    feasForm.hidden = false;
    feasReport.hidden = true;
    $("[data-err]", feasForm).textContent = "";
    openDialog("#dlg-feasibility");
  });

  feasForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("[data-err]", feasForm);
    const body = Object.fromEntries(new FormData(feasForm));
    if (!body.product) { err.textContent = " Selecione um produto."; return; }
    const submit = $("button[type=submit]", feasForm);
    submit.disabled = true; submit.textContent = "Gerando…";
    try {
      const r = await post("/api/feasibility", body);
      feasReport.innerHTML = renderReport(r, body.email);
      feasForm.hidden = true;
      feasReport.hidden = false;
    } catch (ex) { err.textContent = " " + ex.message; }
    finally { submit.disabled = false; submit.textContent = "Gerar relatório"; }
  });

  function renderReport(r, email) {
    const what = r.kind === "export" ? "mercados de destino" : "origens fornecedoras";
    const who = r.kind === "export" ? "Compradores" : "Fornecedores";
    const markets = r.markets.map((m) => `
      <div class="report-market">
        <header><b>${esc(m.flag)} ${esc(m.name)}</b><span class="score ${esc(m.verdict)}">${esc(m.verdict)} · ${m.score}</span></header>
        <p>${m.reasons.map(esc).join(" · ")}</p>
        <div class="cp">${who}: ${m.counterparts.length ? m.counterparts.map((c) => `<a href="${u(`/empresas/${c.id}/`)}">${esc(c.name)}</a>`).join(", ") : "nenhum ainda na plataforma"}</div>
      </div>`).join("");
    return `
      <p class="ok-msg">Relatório nº ${r.id} gerado${STATIC ? " (demonstração: nenhum e-mail é enviado)" : ` — uma cópia vai para ${esc(email)}`}.</p>
      <h3 style="margin-top:10px">${esc(r.product.name)} · ${what}</h3>
      ${r.position ? `<p>${esc(r.position)}</p>` : ""}
      ${markets || "<p>Sem dados suficientes para este recorte.</p>"}
      <p class="muted">Score 0–100: ${r.kind === "export" ? "tamanho do mercado (45%), crescimento (35%) e compradores ativos (20%)" : "preço (40%), escala (40%) e crescimento (20%)"}.</p>
      <div class="cta-row"><a class="btn btn-sm" href="${u(`/mercado/${esc(r.product.slug)}/`)}">Ver o mercado completo</a><button class="btn btn-sm btn-ghost" type="button" data-open="contact">Falar com o time</button></div>`;
  }

  // ---------------------------------------------------------------- contato
  $("#contact-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await post("/api/contact", Object.fromEntries(new FormData(form)));
      form.innerHTML = `<p class="ok-msg">Recebido! O time responde em até um dia útil.</p>`;
    } catch (ex) { $("[data-err]", form).textContent = " " + ex.message; }
  });

  // ---------------------------------------------------------------- interesse em oferta
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-interest]");
    if (!btn) return;
    const wrap = btn.closest("[data-deal]");
    btn.outerHTML = `<form class="inline-form"><input type="email" required placeholder="seu e-mail" aria-label="Seu e-mail"><button class="btn btn-sm">Enviar</button></form>`;
    const form = $("form", wrap);
    $("input", form).focus();
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      try {
        const r = await post(`/api/deals/${wrap.dataset.deal}/interest`, { email: $("input", form).value });
        $("[data-count]", wrap).textContent = `${r.interested} interessados`;
        form.outerHTML = `<span class="ok-msg">Interesse enviado ✓</span>`;
      } catch (ex) { form.insertAdjacentHTML("afterend", `<span class="err-msg">${esc(ex.message)}</span>`); }
    });
  });

  // ---------------------------------------------------------------- newsletter (até 5 produtos)
  const nl = $("#newsletter");
  if (nl) {
    const chips = $$("[data-follow] .chip", nl);
    chips.forEach((c) => c.addEventListener("click", () => {
      const on = c.getAttribute("aria-pressed") === "true";
      if (!on && chips.filter((x) => x.getAttribute("aria-pressed") === "true").length >= 5) return;
      c.setAttribute("aria-pressed", !on);
    }));
    nl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = $("[data-msg]", nl);
      const products = chips.filter((c) => c.getAttribute("aria-pressed") === "true").map((c) => c.dataset.slug);
      try {
        const r = await post("/api/newsletter", { email: nl.email.value, products });
        msg.textContent = r.following.length ? `Cadastrado! Acompanhando ${r.following.length} produto(s).` : "Cadastrado!";
        msg.style.color = "#fff";
      } catch (ex) { msg.textContent = ex.message; msg.style.color = "#ffd2c8"; }
    });
  }

  // ---------------------------------------------------------------- gráfico / tabela
  $$("[data-view]").forEach((b) => b.addEventListener("click", () => {
    const panel = b.closest(".panel");
    $$("[data-view]", panel).forEach((x) => x.setAttribute("aria-pressed", x === b));
    $$("[data-pane]", panel).forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.view; });
  }));

  const chartEl = $("#price-chart");
  if (chartEl) drawPriceChart(chartEl, JSON.parse(chartEl.dataset.series));

  function drawPriceChart(el, series) {
    if (!series.length) { el.innerHTML = '<p class="muted">Sem preços para este produto.</p>'; return; }
    // Cor segue a entidade (Brasil sempre na 1ª cor), nunca a posição no ranking.
    const COLORS = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"];
    const ordered = [...series].sort((a, b) => (a.code === "BR" ? -1 : b.code === "BR" ? 1 : a.code.localeCompare(b.code)));
    ordered.forEach((s, i) => { s.color = COLORS[i % COLORS.length]; });

    const W = 900, H = 320, m = { t: 16, r: 120, b: 30, l: 48 };
    const weeks = series[0].points.map((p) => p[0]);
    const all = series.flatMap((s) => s.points.map((p) => p[1]));
    let lo = Math.min(...all), hi = Math.max(...all);
    const pad = (hi - lo) * 0.12 || hi * 0.1; lo = Math.max(0, lo - pad); hi += pad;
    const x = (i) => m.l + (i / (weeks.length - 1)) * (W - m.l - m.r);
    const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
    const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
    const monthTicks = weeks.map((w, i) => [w, i]).filter(([w], i) => i === 0 || w.slice(5, 7) !== weeks[i - 1].slice(5, 7)).filter((_, i) => i % 2 === 0);
    const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

    // rótulos diretos no fim da linha, afastados para não colidir
    const ends = ordered.map((s) => ({ s, y: y(s.points.at(-1)[1]) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;

    el.innerHTML = `
      <div class="legend">${ordered.map((s) => `<span><i class="swatch" style="background:${s.color}"></i>${esc(s.flag)} ${esc(s.name)}</span>`).join("")}</div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Preço FOB semanal por origem, em dólares por quilo">
        <g class="grid">${ticks.map((t) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>`).join("")}</g>
        <g class="axis">${ticks.map((t) => `<text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join("")}
          ${monthTicks.map(([w, i]) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${MESES[+w.slice(5, 7) - 1]}/${w.slice(2, 4)}</text>`).join("")}</g>
        <g class="series">${ordered.map((s) => `<path stroke="${s.color}" d="${s.points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join("")}"/>`).join("")}</g>
        ${ends.map(({ s, y: ly }) => `<text class="end-label" x="${W - m.r + 8}" y="${ly + 4}">${esc(s.code)} ${fmt(s.points.at(-1)[1])}</text>`).join("")}
        <line class="crosshair" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
        <g class="dots">${ordered.map((s) => `<circle class="dot" r="4.5" fill="${s.color}" visibility="hidden"/>`).join("")}</g>
        <rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" data-hit/>
      </svg>
      <div class="chart-tip" hidden></div>`;

    const svg = $("svg", el), tip = $(".chart-tip", el), cross = $(".crosshair", el), dots = $$(".dot", el);
    const hit = $("[data-hit]", el);
    const show = (evt) => {
      const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
      const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
      const i = Math.max(0, Math.min(weeks.length - 1, Math.round(((loc.x - m.l) / (W - m.l - m.r)) * (weeks.length - 1))));
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
      ordered.forEach((s, k) => { dots[k].setAttribute("cx", x(i)); dots[k].setAttribute("cy", y(s.points[i][1])); dots[k].setAttribute("visibility", "visible"); });
      const rows = [...ordered].sort((a, b) => b.points[i][1] - a.points[i][1]);
      tip.innerHTML = `<b>Semana de ${weeks[i].split("-").reverse().join("/")}</b>${rows.map((s) => `<div><span><i class="swatch" style="background:${s.color}"></i>${esc(s.name)}</span><span class="num">US$ ${fmt(s.points[i][1])}</span></div>`).join("")}`;
      const rect = svg.getBoundingClientRect(), host = el.getBoundingClientRect();
      const px = (x(i) / W) * rect.width + rect.left - host.left;
      tip.style.left = `${Math.min(Math.max(px, 90), host.width - 90)}px`;
      tip.style.top = `${rect.top - host.top + 20}px`;
      tip.hidden = false;
    };
    const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); };
    hit.addEventListener("pointermove", show);
    hit.addEventListener("pointerleave", hide);
  }
})();
