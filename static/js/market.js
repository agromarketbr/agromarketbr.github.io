// AgroMarket — venda direta: painel do produtor (/painel) e jornada do comprador (/comprar).
// Tudo roda no navegador: conta, anúncios e propostas ficam no localStorage e são
// compartilhados entre abas, então o comprador numa aba e o produtor em outra se veem ao vivo.
(() => {
  "use strict";
  const app = document.getElementById("mp-app");
  if (!app) return;

  const D = JSON.parse(document.getElementById("mp-data").textContent);
  const MODE = app.dataset.mode; // "seller" | "buyer"
  const ROOT = document.documentElement;
  const STATIC = ROOT.hasAttribute("data-static");
  const BASE = ROOT.dataset.base || "";
  const page = (p) => (STATIC ? `${BASE}${p}/` : p);

  // ---------------------------------------------------------------- utilidades
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fold = (s) => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
  const num = (n, d = 0) => Number(n || 0).toLocaleString("pt-BR", { maximumFractionDigits: d });
  const money = (n) => {
    const big = Math.abs(n) >= 1000;
    return Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: big ? 0 : 2, maximumFractionDigits: big ? 0 : 2 });
  };
  const moneyShort = (n) => (n >= 1e6 ? `R$ ${num(n / 1e6, 1)} mi` : n >= 1e3 ? `R$ ${num(n / 1e3, 0)} mil` : money(n));
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const DAY = 864e5;
  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 6e4);
    if (m < 1) return "agora";
    if (m < 60) return `há ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `há ${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? "ontem" : `há ${d} dias`;
  };
  const val = (s) => valX(s);
  const dateBR = (iso) => (iso ? iso.split("-").reverse().join("/") : "");

  const PRODUCTS = Object.fromEntries(D.products.map((p) => [p.slug, p]));
  const unit = (slug) => D.units[PRODUCTS[slug].unit];
  const per = (slug) => unit(slug).price.replace("R$/", "");
  const priceTag = (slug, price) => `${money(price)}<small>/${per(slug)}</small>`;
  const qtyTag = (slug, q) => `${num(q, 2)} ${unit(slug).qty}`;
  const lotValue = (slug, qty, price) => qty * unit(slug).per_qty * price;
  const vsRef = (slug, price) => (PRODUCTS[slug].ref ? (price / PRODUCTS[slug].ref - 1) * 100 : 0);
  const roundPrice = (v) => (v >= 100 ? Math.round(v) : Math.round(v * 100) / 100);
  const DDD = { MG: 34, ES: 27, MT: 66, GO: 64, PE: 87, PI: 89, BA: 73, PA: 91, CE: 85, SP: 17, RN: 84, PR: 44, RS: 54, SC: 49, MS: 67 };
  const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

  // ---------------------------------------------------------------- estado (compartilhado entre abas)
  const KEY = "agromarket:mp:v1";
  const blank = () => ({ producer: null, buyer: null, listings: [], proposals: [], draft: null, seq: 1 });
  const load = () => { try { return { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return blank(); } };
  let S = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); return true; }
    catch { toast("Não foi possível salvar neste navegador (armazenamento cheio ou bloqueado)."); return false; }
  }
  const uid = (p) => `${p}${Date.now().toString(36)}${(S.seq++).toString(36)}`;

  // ---------------------------------------------------------------- dados derivados
  const LOADED = Date.now();
  const myProducer = () => S.producer && {
    id: "me", name: S.producer.farm, owner: S.producer.name, city: S.producer.city, uf: S.producer.uf,
    since: new Date(S.producer.created).getFullYear(), rating: null, verified: false,
    deals: S.proposals.filter((p) => p.status === "concluida" && listing(p.listingId)?.owner === "me").length,
    email: S.producer.email, phone: S.producer.phone,
  };
  function listings() {
    const mine = S.listings.map((l) => ({ ...l, owner: "me", producer: myProducer() }));
    const demo = D.listings.map((l) => ({ ...l, created: LOADED - l.days_ago * DAY }));
    return [...mine, ...demo];
  }
  const listing = (id) => listings().find((l) => l.id === id);
  const photoOf = (l, i = 0) => l.photos?.[i] || PRODUCTS[l.product].photo_lg;
  const viewsOf = (l) => (l.owner === "me" ? Math.min(900, Math.floor((Date.now() - l.created) / 45e3)) : l.views);
  const visible = (p) => !p.arrivesAt || p.arrivesAt <= Date.now();
  const sellerProposals = () => S.proposals.filter((p) => visible(p) && listing(p.listingId)?.owner === "me");
  const buyerProposals = () => S.proposals.filter((p) => p.from === "me");
  const contactOf = (prod) => prod.id === "me"
    ? { email: prod.email, phone: prod.phone }
    : { email: `comercial@${fold(prod.name).replace(/[^a-z0-9]+/g, "")}.com.br`,
        phone: `(${DDD[prod.uf] || 11}) 9${String(1000 + (hash(prod.id) % 9000))}-${String(1000 + (hash(prod.name) % 9000))}` };

  // ---------------------------------------------------------------- avisos
  let toastBox;
  function toast(msg) {
    toastBox ??= document.body.appendChild(Object.assign(document.createElement("div"), { className: "toast-stack", role: "status" }));
    const el = toastBox.appendChild(Object.assign(document.createElement("div"), { className: "toast", textContent: msg }));
    setTimeout(() => el.classList.add("out"), 4200);
    setTimeout(() => el.remove(), 4800);
  }

  // ---------------------------------------------------------------- negociação
  const STAGES = ["Proposta aceita", "Contrato assinado", "Carga entregue", "Pagamento confirmado"];
  const STATUS = {
    enviada: ["Aguardando o produtor", "wait"],
    contraproposta: ["Contraproposta", "counter"],
    aceita: ["Em andamento", "ok"],
    concluida: ["Concluído", "done"],
    recusada: ["Recusada", "no"],
    cancelada: ["Cancelada", "no"],
  };
  const log = (p, by, text) => p.log.push({ at: Date.now(), by, text });
  const farmName = (p) => listing(p.listingId)?.producer?.name || "O produtor";

  function accept(p, by, price) {
    p.status = "aceita"; p.final = price; p.stage = 0; p.acceptedAt = Date.now();
    log(p, by, `${by === "produtor" ? farmName(p) : p.buyer.company} aceitou a ${by === "produtor" ? "proposta" : "contraproposta"} a ${money(price)}/${per(listing(p.listingId).product)}. Contatos liberados.`);
  }

  // Produtores de exemplo respondem sozinhos às propostas do comprador.
  function autoProducer(p, l) {
    const r = p.price / l.price;
    if (r >= 0.97) {
      accept(p, "produtor", p.price);
      if (MODE === "buyer") toast(`${l.producer.name} aceitou sua proposta!`);
    } else if (r >= 0.88) {
      p.status = "contraproposta";
      p.counter = roundPrice((p.price + l.price) / 2);
      log(p, "produtor", `Podemos fechar em ${money(p.counter)}/${per(l.product)}, com a mesma quantidade e entrega.`);
      if (MODE === "buyer") toast(`${l.producer.name} enviou uma contraproposta.`);
    } else {
      p.status = "recusada";
      log(p, "produtor", `Obrigado pelo interesse. ${money(p.price)} fica abaixo do nosso custo; o mercado está em torno de ${money(PRODUCTS[l.product].ref)}/${per(l.product)}.`);
      if (MODE === "buyer") toast(`${l.producer.name} recusou a proposta.`);
    }
  }

  // Compradores de exemplo mandam propostas para os anúncios do visitante.
  function scheduleDemoBuyers(l) {
    const pool = D.buyers.filter((b) => b.cats.includes(PRODUCTS[l.product].category_slug));
    const b1 = pool[hash(l.id) % pool.length];
    const b2 = pool.length > 1 ? pool[(hash(l.id) + 1) % pool.length] : b1;
    const q = (f) => Math.max(l.min_qty || 0, Math.round(l.qty * f * 10) / 10);
    const mk = (buyer, qty, price, delay, msg, payment) => {
      const p = { id: uid("q"), from: "demo", listingId: l.id, buyer, qty, price, delivery: l.delivery, payment,
        message: msg, status: "enviada", created: Date.now() + delay, arrivesAt: Date.now() + delay, log: [] };
      p.log.push({ at: p.created, by: "comprador", text: msg });
      S.proposals.push(p);
    };
    const name = PRODUCTS[l.product].name.toLowerCase();
    mk(b1, q(0.4), Math.round(l.price * 0.93 * 100) / 100, 9000,
      `Temos interesse recorrente em ${name}. Conseguem esse preço para ${qtyTag(l.product, q(0.4))}? Retiramos com transporte próprio.`, "30 dias");
    mk(b2, q(0.15), l.price, 30000,
      `Fechamos pelo preço anunciado. Precisamos de amostra antes do carregamento.`, "À vista na entrega");
  }

  function tick() {
    const t = Date.now();
    let changed = false;
    for (const p of S.proposals) {
      const l = listing(p.listingId);
      if (!l) continue;
      if (MODE === "seller" && p.arrivesAt && p.arrivesAt <= t && !p.announced) {
        p.announced = true; changed = true;
        toast(`Nova proposta de ${p.buyer.company} para ${PRODUCTS[l.product].name}`);
      }
      if (!p.dueAt || p.dueAt > t) continue;
      p.dueAt = null; changed = true;
      if (p.status === "enviada" && l.owner === "demo") autoProducer(p, l);
      else if (p.status === "contraproposta" && p.from === "demo") {
        accept(p, "comprador", p.counter);
        if (MODE === "seller") toast(`${p.buyer.company} aceitou sua contraproposta!`);
      }
    }
    if (changed) { save(); render(true); }
  }
  setInterval(tick, 1500);

  window.addEventListener("storage", (e) => { if (e.key === KEY) { S = load(); render(true); } });

  // ---------------------------------------------------------------- roteamento
  const route = () => {
    const [view, arg] = location.hash.replace(/^#/, "").split("/");
    return { view: view || (MODE === "seller" ? "inicio" : "vitrine"), arg: arg ? decodeURIComponent(arg) : "" };
  };
  const LIVE = new Set(["inicio", "anuncios", "propostas", "negocios", "vitrine", "publicado"]);
  const toTop = () => { if (app.getBoundingClientRect().top < 0) app.scrollIntoView({ block: "start" }); };
  window.addEventListener("hashchange", () => { render(); toTop(); });

  function render(live = false) {
    const { view, arg } = route();
    if (live && !LIVE.has(view)) { paintBadges(); return; }
    if (live && (view === "propostas" || view === "anuncios") && app.contains(document.activeElement) && document.activeElement.matches("input, textarea, select")) { paintBadges(); return; }
    app.innerHTML = MODE === "seller" ? seller(view, arg) : buyer(view, arg);
    paintBadges();
    afterRender(view);
  }

  function paintBadges() {
    const n = MODE === "seller"
      ? sellerProposals().filter((p) => p.status === "enviada").length
      : buyerProposals().filter((p) => p.status === "contraproposta").length;
    app.querySelectorAll("[data-badge]").forEach((b) => { b.textContent = n || ""; b.hidden = !n; });
  }

  // ================================================================ COMPONENTES
  function meter(slug, price) {
    const p = PRODUCTS[slug];
    if (!p.ref || !price) return "";
    const pct = vsRef(slug, price);
    const pos = Math.max(0, Math.min(100, 50 + pct * 2));
    const [label, tone] = Math.abs(pct) <= 5 ? ["Em linha com o mercado", "ok"] : pct < 0 ? [`${num(-pct)}% abaixo da referência`, "low"] : [`${num(pct)}% acima da referência`, "high"];
    return `<div class="meter">
      <div class="meter-track"><span class="meter-band"></span><i style="left:${pos}%"></i></div>
      <div class="meter-scale"><span>−25%</span><span>Referência ${money(p.ref)}/${per(slug)}</span><span>+25%</span></div>
      <p class="meter-label ${tone}">${label}</p>
      ${p.fob_usd_kg ? `<p class="muted">Exportação FOB Brasil: US$ ${num(p.fob_usd_kg, 2)}/kg na semana mais recente. <a href="${page(`/mercado/${slug}`)}" target="_blank" rel="noopener">Ver o mercado</a></p>` : ""}
    </div>`;
  }

  const pill = (status) => {
    const label = MODE === "seller" ? { enviada: "Aguardando você", contraproposta: "Aguardando o comprador" }[status] : status === "contraproposta" ? "Contraproposta recebida" : null;
    return `<span class="st st-${STATUS[status][1]}">${label || STATUS[status][0]}</span>`;
  };
  const certChips = (certs) => (certs || []).map((c) => `<span class="cert">${esc(c)}</span>`).join("");
  const stars = (r) => (r ? `<span class="stars" aria-label="Nota ${num(r, 1)} de 5">★ ${num(r, 1)}</span>` : `<span class="muted">Novo na plataforma</span>`);

  function listingCard(l) {
    const p = PRODUCTS[l.product];
    const pct = vsRef(l.product, l.price);
    return `<a class="lot-card" href="#anuncio/${esc(l.id)}">
      <span class="lot-photo"><img src="${esc(photoOf(l))}" alt="" loading="lazy" decoding="async">
        ${l.owner === "me" ? `<span class="lot-flag">Seu anúncio</span>` : ""}</span>
      <span class="lot-body">
        <span class="lot-cat">${esc(p.category)}</span>
        <b class="lot-name">${esc(p.name)}</b>
        <span class="lot-spec">${esc(l.spec)}</span>
        <span class="lot-farm">${esc(l.producer.name)}${l.producer.verified ? ` <span class="vtag" title="Produtor verificado">✓</span>` : ""} · ${esc(l.city)}/${esc(l.uf)}</span>
        <span class="lot-price">${priceTag(l.product, l.price)}</span>
        <span class="lot-meta"><span>${qtyTag(l.product, l.qty)} disponíveis</span>
          ${p.ref ? `<span class="vs ${Math.abs(pct) <= 5 ? "ok" : pct < 0 ? "low" : "high"}">${pct <= 0 ? "▼" : "▲"} ${num(Math.abs(pct))}% vs ref.</span>` : ""}</span>
        <span class="lot-certs">${certChips(l.certs.slice(0, 2))}</span>
      </span></a>`;
  }

  function thread(p) {
    return `<ol class="thread">${p.log.map((m) => `<li class="by-${m.by}"><span class="who">${m.by === "produtor" ? esc(farmName(p)) : m.by === "comprador" ? esc(p.buyer.company) : "AgroMarket"} · ${ago(m.at)}</span>${esc(m.text)}</li>`).join("")}</ol>`;
  }

  function stages(p, role) {
    const done = p.status === "concluida" ? STAGES.length : p.stage + 1;
    const next = STAGES[done];
    return `<ol class="stages">${STAGES.map((s, i) => `<li class="${i < done ? "done" : ""}${i === done ? " now" : ""}"><span>${i + 1}</span>${s}</li>`).join("")}</ol>
      ${next ? `<button class="btn btn-sm btn-blue" type="button" data-act="advance" data-id="${p.id}">Marcar “${next}”</button>
        <span class="muted">${role === "seller" ? "Atualize a cada etapa; o comprador vê na hora." : "Atualize a cada etapa; o produtor vê na hora."}</span>`
        : `<p class="ok-msg">Negócio concluído. ${role === "seller" ? "O valor entra no seu histórico de vendas." : "Avalie o produtor para ajudar outros compradores."}</p>`}`;
  }

  function contacts(c, title) {
    return `<div class="contact-box"><b>${title}</b><span>✉ <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></span><span>☎ ${esc(c.phone)}</span></div>`;
  }

  // ================================================================ PRODUTOR
  function seller(view, arg) {
    if (!S.producer) return onboarding();
    const pending = sellerProposals().filter((p) => p.status === "enviada").length;
    const side = `
      <aside class="mp-side">
        <div class="farm-id"><span class="avatar">${esc(S.producer.farm.slice(0, 1))}</span>
          <div><b>${esc(S.producer.farm)}</b><span>${esc(S.producer.city)}/${esc(S.producer.uf)}</span></div></div>
        <a class="btn btn-sm side-cta" href="#novo">+ Anunciar produto</a>
        <nav aria-label="Painel do produtor">
          ${[["inicio", "Início"], ["anuncios", `Meus anúncios <em>${S.listings.length}</em>`], ["propostas", `Propostas <i data-badge hidden></i>`], ["negocios", "Negócios"], ["fazenda", "Minha fazenda"]]
            .map(([k, label]) => `<a href="#${k}" ${view === k ? 'aria-current="page"' : ""}>${label}</a>`).join("")}
        </nav>
        <a class="side-link" href="${page("/comprar")}" target="_blank" rel="noopener">Ver a vitrine do comprador ↗</a>
      </aside>`;
    const views = { inicio: sHome, anuncios: sListings, novo: sWizard, editar: sWizard, publicado: sPublished, propostas: sProposals, negocios: sDeals, fazenda: sFarm };
    return `<div class="mp-layout">${side}<section class="mp-main">${(views[view] || sHome)(arg, pending)}</section></div>`;
  }

  // ---------------- cadastro
  let onb = { step: 1, data: {} };
  const EXAMPLE_PRODUCER = { name: "Rodrigo Martins", email: "rodrigo@fazendaboavista.com.br", phone: "(34) 99812-4410",
    farm: "Fazenda Boa Vista", city: "Araguari", uf: "MG", area: "260", cultures: ["Café", "Milho"], certs: ["Rastreável"] };

  function onboarding() {
    const d = onb.data;
    const steps = `<ol class="wiz-steps two">${["Sua conta", "Sua propriedade"].map((s, i) => `<li class="${i + 1 < onb.step ? "done" : i + 1 === onb.step ? "now" : ""}"><span>${i + 1}</span>${s}</li>`).join("")}</ol>`;
    const step1 = `
      <label class="field full"><span>Seu nome</span><input name="name" required value="${esc(d.name)}" autocomplete="name"></label>
      <label class="field"><span>E-mail</span><input type="email" name="email" required value="${esc(d.email)}" autocomplete="email"></label>
      <label class="field"><span>WhatsApp</span><input name="phone" required value="${esc(d.phone)}" placeholder="(00) 90000-0000" autocomplete="tel"></label>`;
    const step2 = `
      <label class="field full"><span>Nome da propriedade</span><input name="farm" required value="${esc(d.farm)}" placeholder="Ex.: Fazenda Boa Vista"></label>
      <label class="field"><span>Município</span><input name="city" required value="${esc(d.city)}"></label>
      <label class="field"><span>UF</span><select name="uf" required><option value="">UF</option>${D.ufs.map((u) => `<option ${d.uf === u ? "selected" : ""}>${u}</option>`).join("")}</select></label>
      <label class="field"><span>Área produtiva (ha)</span><input name="area" inputmode="decimal" value="${esc(d.area)}"></label>
      <div class="field full"><span>Certificações</span><div class="chips" data-chips="certs">${D.certifications.map((c) => `<button type="button" class="chip" aria-pressed="${(d.certs || []).includes(c)}" data-val="${esc(c)}">${esc(c)}</button>`).join("")}</div></div>`;
    return `<div class="onb">
      <div class="onb-intro">
        <h2>Comece a vender em 3 minutos</h2>
        <ol class="howto">
          <li><b>Cadastre a fazenda</b><span>Nome, local e certificações. Sem custo e sem fidelidade.</span></li>
          <li><b>Anuncie o lote</b><span>Quantidade, preço e entrega, com a referência do mercado ao lado.</span></li>
          <li><b>Receba propostas</b><span>Compradores ativos no seu produto são avisados na hora.</span></li>
          <li><b>Feche e acompanhe</b><span>Aceite, contraproponha e acompanhe do contrato ao pagamento.</span></li>
        </ol>
      </div>
      <form class="panel onb-form" data-form="onboarding" novalidate>
        ${steps}
        <div class="form-grid">${onb.step === 1 ? step1 : step2}</div>
        <div class="wiz-actions">
          ${onb.step === 2 ? `<button class="btn btn-ghost" type="button" data-act="onb-back">Voltar</button>` : `<button class="link-btn" type="button" data-act="onb-example">Preencher com dados de exemplo</button>`}
          <button class="btn" type="submit">${onb.step === 1 ? "Continuar" : "Criar meu painel"}</button>
        </div>
        <p class="err-msg" data-err></p>
      </form>
    </div>`;
  }

  // ---------------- início
  function sHome(_, pending) {
    const mine = listings().filter((l) => l.owner === "me");
    const props = sellerProposals();
    const active = mine.filter((l) => l.status === "ativo");
    const negotiating = props.filter((p) => p.status === "aceita").reduce((s, p) => s + lotValue(listing(p.listingId).product, p.qty, p.final), 0);
    const sold = props.filter((p) => p.status === "concluida").reduce((s, p) => s + lotValue(listing(p.listingId).product, p.qty, p.final), 0);
    const h = new Date().getHours();
    const hello = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
    const kpis = `<div class="kpi-row">
      <div class="kpi"><span>Anúncios ativos</span><b>${active.length}</b></div>
      <div class="kpi"><span>Visualizações</span><b>${num(mine.reduce((s, l) => s + viewsOf(l), 0))}</b></div>
      <div class="kpi"><span>Propostas aguardando você</span><b>${pending}</b></div>
      <div class="kpi"><span>Em negociação · vendido</span><b>${moneyShort(negotiating)}</b><small>${moneyShort(sold)} concluído</small></div>
    </div>`;
    const first = !mine.length ? `<div class="panel empty-cta">
        <h3>Anuncie seu primeiro lote</h3>
        <p>Escolha o produto, informe quantidade e preço e publique. Compradores do produto são avisados na hora.</p>
        <a class="btn" href="#novo">+ Anunciar produto</a></div>` : "";
    const attention = props.filter((p) => p.status === "enviada").slice(0, 3);
    const demand = (D.demand || []).slice(0, 5);
    return `<h2>${hello}, ${esc(S.producer.name.split(" ")[0])}</h2>
      <p class="muted">Resumo da ${esc(S.producer.farm)} hoje.</p>
      ${kpis}${first}
      <div class="cols-2">
        <div class="panel"><h3>Precisa da sua atenção</h3>
          ${attention.length ? `<ul class="mini-list">${attention.map((p) => { const l = listing(p.listingId); return `<li><a href="#propostas"><b>${esc(p.buyer.company)}</b><span>${esc(PRODUCTS[l.product].name)} · ${qtyTag(l.product, p.qty)} a ${money(p.price)}/${per(l.product)}</span></a><span class="muted">${ago(p.created)}</span></li>`; }).join("")}</ul>`
            : `<p class="muted">${mine.length ? "Nenhuma proposta pendente. Assim que um comprador enviar, ela aparece aqui." : "Quando você anunciar, as propostas dos compradores aparecem aqui."}</p>`}
        </div>
        <div class="panel"><h3>Compradores procurando agora</h3>
          <p class="muted">Produtos com mais empresas compradoras ativas nas últimas 4 semanas.</p>
          <ul class="mini-list">${demand.map((d) => `<li><a href="#novo/${esc(d.slug)}"><b>${esc(d.name)}</b><span>${d.companies} compradores ativos</span></a><a class="link-arrow" href="#novo/${esc(d.slug)}">Anunciar</a></li>`).join("")}</ul>
        </div>
      </div>
      ${mine.length ? `<div class="panel"><div class="panel-head"><h3>Seus anúncios</h3><a class="link-arrow" href="#anuncios">Ver todos</a></div>${listingRows(mine.slice(0, 4))}</div>` : ""}`;
  }

  function listingRows(ls) {
    return `<div class="rows">${ls.map((l) => {
      const n = sellerProposals().filter((p) => p.listingId === l.id).length;
      return `<div class="row-item">
        <img src="${esc(photoOf(l))}" alt="">
        <div class="ri-main"><b>${esc(PRODUCTS[l.product].name)}</b><span>${esc(l.spec)}</span>
          <span class="muted">Publicado ${ago(l.created)} · ${num(viewsOf(l))} visualizações · ${n} proposta${n === 1 ? "" : "s"}</span></div>
        <div class="ri-num"><b>${priceTag(l.product, l.price)}</b><span>${qtyTag(l.product, l.qty)}</span></div>
        <span class="st st-${l.status === "ativo" ? "ok" : l.status === "vendido" ? "done" : "wait"}">${{ ativo: "Ativo", pausado: "Pausado", vendido: "Vendido" }[l.status]}</span>
      </div>`; }).join("")}</div>`;
  }

  // ---------------- meus anúncios
  function sListings() {
    const mine = listings().filter((l) => l.owner === "me");
    if (!mine.length) return `<h2>Meus anúncios</h2><div class="panel empty-cta"><h3>Você ainda não tem anúncios</h3><p>Leva poucos minutos. Você vê a referência de preço do mercado antes de publicar.</p><a class="btn" href="#novo">+ Anunciar produto</a></div>`;
    return `<div class="panel-head"><h2>Meus anúncios</h2><a class="btn btn-sm" href="#novo">+ Anunciar produto</a></div>
      ${mine.map((l) => `<div class="panel listing-admin">
        ${listingRows([l])}
        <div class="la-actions">
          <a class="btn btn-sm btn-ghost" href="${page("/comprar")}#anuncio/${esc(l.id)}" target="_blank" rel="noopener">Ver como o comprador vê ↗</a>
          <a class="btn btn-sm btn-ghost" href="#editar/${esc(l.id)}">Editar</a>
          ${l.status === "vendido" ? "" : `<button class="btn btn-sm btn-ghost" type="button" data-act="toggle" data-id="${esc(l.id)}">${l.status === "ativo" ? "Pausar" : "Reativar"}</button>
          <button class="btn btn-sm btn-ghost" type="button" data-act="sold" data-id="${esc(l.id)}">Marcar como vendido</button>`}
          <button class="link-btn danger" type="button" data-act="delete" data-id="${esc(l.id)}">Excluir</button>
        </div></div>`).join("")}`;
  }

  // ---------------- novo anúncio (4 passos)
  const WIZ = ["Produto", "Detalhes do lote", "Preço e entrega", "Fotos e revisão"];
  function newDraft(slug = "") {
    return { step: slug ? 2 : 1, product: slug, spec: "", harvest: "", qty: "", min_qty: "", available: new Date().toISOString().slice(0, 10),
      city: S.producer.city, uf: S.producer.uf, certs: [...(S.producer.certs || [])], description: "", price: "", delivery: "fazenda", accepts_offers: true, photos: [] };
  }
  function sWizard(arg) {
    const { view } = route();
    if (view === "editar") {
      if (!S.draft || S.draft.editId !== arg) {
        const l = S.listings.find((x) => x.id === arg);
        if (!l) return `<p>Anúncio não encontrado. <a href="#anuncios">Voltar</a></p>`;
        S.draft = { ...structuredClone(l), editId: l.id, step: 2 };
      }
    } else if (!S.draft || S.draft.editId || (arg && S.draft.product !== arg)) {
      S.draft = newDraft(arg && PRODUCTS[arg] ? arg : "");
    }
    if (view === "novo" && arg) history.replaceState(null, "", "#novo");
    const d = S.draft;
    const head = `<div class="panel-head"><h2>${d.editId ? "Editar anúncio" : "Novo anúncio"}</h2>${d.editId ? "" : `<button class="link-btn" type="button" data-act="wiz-reset">Recomeçar</button>`}</div>
      <ol class="wiz-steps">${WIZ.map((s, i) => `<li class="${i + 1 < d.step ? "done" : i + 1 === d.step ? "now" : ""}"><button type="button" data-act="wiz-go" data-step="${i + 1}" ${i + 1 > d.step || (i === 0 && d.editId) ? "disabled" : ""}><span>${i + 1}</span>${s}</button></li>`).join("")}</ol>`;
    return head + [wizProduct, wizDetails, wizPrice, wizReview][d.step - 1](d);
  }

  function wizProduct(d) {
    const cats = [...new Map(D.products.map((p) => [p.category_slug, p.category])).entries()];
    return `<div class="panel">
      <h3>O que você vai vender?</h3>
      <div class="pick-tools"><input type="search" data-pick-q placeholder="Buscar produto ou NCM…" aria-label="Buscar produto">
        <div class="chips" data-pick-cat><button type="button" class="chip" aria-pressed="true" data-val="">Todos</button>${cats.map(([s, n]) => `<button type="button" class="chip" aria-pressed="false" data-val="${esc(s)}">${esc(n)}</button>`).join("")}</div></div>
      <div class="pick-grid">${D.products.map((p) => `<button type="button" class="pick ${d.product === p.slug ? "on" : ""}" data-act="pick" data-slug="${esc(p.slug)}" data-cat="${esc(p.category_slug)}" data-q="${esc(fold(p.name + " " + p.ncm))}">
        <img src="${esc(p.photo)}" alt="" loading="lazy"><b>${esc(p.name)}</b><span>${esc(p.category)} · ${esc(D.units[p.unit].price)}</span></button>`).join("")}</div>
    </div>`;
  }

  function wizDetails(d) {
    const p = PRODUCTS[d.product], u = unit(d.product);
    const ex = D.listings.find((l) => l.product === d.product);
    return `<form class="panel" data-form="wiz" novalidate>
      <div class="wiz-product"><img src="${esc(p.photo)}" alt=""><div><b>${esc(p.name)}</b><span>NCM ${esc(p.ncm)} · ${esc(p.category)}</span></div>
        ${d.editId ? "" : `<button class="link-btn" type="button" data-act="wiz-go" data-step="1">Trocar</button>`}</div>
      <div class="form-grid three">
        <label class="field full"><span>Variedade e classificação</span><input name="spec" required value="${esc(d.spec)}" placeholder="${esc(ex ? `Ex.: ${ex.spec}` : "Ex.: variedade, tipo, embalagem")}"></label>
        <label class="field"><span>Safra</span><input name="harvest" required value="${esc(d.harvest)}" placeholder="Ex.: 2026/27"></label>
        <label class="field"><span>Quantidade disponível (${u.qty})</span><input name="qty" inputmode="decimal" required value="${esc(d.qty)}"></label>
        <label class="field"><span>Lote mínimo (${u.qty})</span><input name="min_qty" inputmode="decimal" value="${esc(d.min_qty)}" placeholder="Opcional"></label>
        <label class="field"><span>Disponível a partir de</span><input type="date" name="available" value="${esc(d.available)}"></label>
        <label class="field"><span>Município da carga</span><input name="city" required value="${esc(d.city)}"></label>
        <label class="field"><span>UF</span><select name="uf">${D.ufs.map((x) => `<option ${d.uf === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
        <div class="field full"><span>Certificações do lote</span><div class="chips" data-chips="certs">${D.certifications.map((c) => `<button type="button" class="chip" aria-pressed="${d.certs.includes(c)}" data-val="${esc(c)}">${esc(c)}</button>`).join("")}</div></div>
        <label class="field full"><span>Descrição para o comprador</span><textarea name="description" rows="3" placeholder="Como é produzido, armazenagem, laudos, amostra…">${esc(d.description)}</textarea></label>
      </div>
      <div class="wiz-actions">${ex && !d.editId ? `<button class="link-btn" type="button" data-act="wiz-example">Preencher com exemplo</button>` : "<span></span>"}<button class="btn" type="submit">Continuar</button></div>
      <p class="err-msg" data-err></p>
    </form>`;
  }

  function wizPrice(d) {
    const u = unit(d.product);
    return `<form class="panel" data-form="wiz" novalidate>
      <div class="price-grid">
        <div>
          <label class="field"><span>Seu preço (${esc(u.price)})</span>
            <div class="money-input"><em>R$</em><input name="price" inputmode="decimal" required value="${esc(d.price)}" data-live="price" placeholder="${esc(num(PRODUCTS[d.product].ref, 2))}"><em>/${per(d.product)}</em></div></label>
          <p class="lot-total" data-total>${totalLine(d)}</p>
          <label class="check"><input type="checkbox" name="accepts_offers" ${d.accepts_offers ? "checked" : ""}> Aceito receber propostas abaixo do preço</label>
        </div>
        <div class="ref-box"><b>Como seu preço se compara</b><div data-meter>${meter(d.product, val(d.price) || PRODUCTS[d.product].ref)}</div></div>
      </div>
      <fieldset class="field full"><span>Entrega</span>
        <div class="radio-cards">${Object.entries(D.delivery).map(([k, label]) => `<label class="radio-card"><input type="radio" name="delivery" value="${k}" ${d.delivery === k ? "checked" : ""}><b>${esc(label)}</b><span>${{ fazenda: "O comprador busca na sua propriedade. Mais simples para você.", cif: "Você entrega no endereço do comprador. Preço inclui o frete.", porto: "Você leva até o porto. Ideal para exportação." }[k]}</span></label>`).join("")}</div>
      </fieldset>
      <div class="wiz-actions"><button class="btn btn-ghost" type="button" data-act="wiz-go" data-step="2">Voltar</button><button class="btn" type="submit">Continuar</button></div>
      <p class="err-msg" data-err></p>
    </form>`;
  }

  const totalLine = (d) => {
    const price = val(d.price), qty = val(d.qty);
    return price && qty ? `Valor total do lote: <b>${money(lotValue(d.product, qty, price))}</b> (${qtyTag(d.product, qty)})` : "Informe o preço para ver o valor total do lote.";
  };

  function wizReview(raw) {
    const d = { ...raw, qty: val(raw.qty), price: val(raw.price), min_qty: val(raw.min_qty) || 0 };
    const preview = { ...d, id: "preview", owner: "me", producer: myProducer(), created: Date.now() };
    return `<div class="panel">
      <h3>Fotos do lote</h3>
      <p class="muted">Até 3 fotos. Lotes com foto real recebem mais propostas. Sem foto, usamos uma imagem ilustrativa do produto.</p>
      <div class="uploads">${[0, 1, 2].map((i) => d.photos[i]
        ? `<div class="up has"><img src="${esc(d.photos[i])}" alt="Foto ${i + 1}"><button type="button" data-act="photo-del" data-i="${i}" aria-label="Remover foto">×</button></div>`
        : `<label class="up"><input type="file" accept="image/*" data-photo hidden><span>+ Adicionar foto</span></label>`).join("")}</div>
      <p class="err-msg" data-err></p>
    </div>
    <div class="review">
      <div><h3>Como o comprador vai ver</h3><div class="preview-wrap">${listingCard(preview).replace(/^<a /, '<div ').replace(/<\/a>$/, "</div>")}</div></div>
      <div class="panel"><h3>Resumo</h3>
        <dl class="sum">
          <dt>Produto</dt><dd>${esc(PRODUCTS[d.product].name)}</dd>
          <dt>Classificação</dt><dd>${esc(d.spec)}</dd>
          <dt>Safra</dt><dd>${esc(d.harvest)}</dd>
          <dt>Quantidade</dt><dd>${qtyTag(d.product, d.qty)}${d.min_qty ? ` · mínimo ${qtyTag(d.product, d.min_qty)}` : ""}</dd>
          <dt>Preço</dt><dd>${priceTag(d.product, d.price)}</dd>
          <dt>Valor do lote</dt><dd>${money(lotValue(d.product, d.qty, d.price))}</dd>
          <dt>Entrega</dt><dd>${esc(D.delivery[d.delivery])}</dd>
          <dt>Local</dt><dd>${esc(d.city)}/${esc(d.uf)} · a partir de ${dateBR(d.available)}</dd>
          <dt>Certificações</dt><dd>${d.certs.length ? d.certs.map(esc).join(", ") : "—"}</dd>
        </dl>
        <div class="wiz-actions"><button class="btn btn-ghost" type="button" data-act="wiz-go" data-step="3">Voltar</button>
          <button class="btn" type="button" data-act="publish">${d.editId ? "Salvar alterações" : "Publicar anúncio"}</button></div>
      </div>
    </div>`;
  }

  function sPublished(arg) {
    const l = listing(arg);
    if (!l) return sHome("", 0);
    return `<div class="panel success">
      <div class="big-check">✓</div>
      <h2>Anúncio publicado!</h2>
      <p>${esc(PRODUCTS[l.product].name)} · ${qtyTag(l.product, l.qty)} a ${money(l.price)}/${per(l.product)} já está na vitrine.</p>
      <ol class="howto compact">
        <li><b>Agora</b><span>Compradores ativos em ${esc(PRODUCTS[l.product].name.toLowerCase())} recebem o aviso do seu lote.</span></li>
        <li><b>Em minutos</b><span>As propostas chegam em <a href="#propostas">Propostas</a>. Você aceita, recusa ou contrapropõe.</span></li>
        <li><b>Ao aceitar</b><span>Os contatos são liberados e o negócio passa para <a href="#negocios">Negócios</a>.</span></li>
      </ol>
      <div class="cta-row center"><a class="btn" href="${page("/comprar")}#anuncio/${esc(l.id)}" target="_blank" rel="noopener">Ver na vitrine ↗</a><a class="btn btn-ghost" href="#inicio">Ir para o início</a></div>
      <p class="muted">Demonstração: dois compradores de exemplo vão mandar propostas nos próximos segundos.</p>
    </div>`;
  }

  // ---------------- propostas
  let sTab = "pendentes";
  function sProposals() {
    const all = sellerProposals().sort((a, b) => b.created - a.created);
    const groups = {
      pendentes: all.filter((p) => p.status === "enviada"),
      andamento: all.filter((p) => p.status === "contraproposta" || p.status === "aceita"),
      encerradas: all.filter((p) => ["concluida", "recusada", "cancelada"].includes(p.status)),
    };
    const list = groups[sTab];
    return `<h2>Propostas recebidas</h2>
      <div class="toggle-group" role="tablist">${[["pendentes", "Aguardando você"], ["andamento", "Em negociação"], ["encerradas", "Encerradas"]].map(([k, l]) => `<button type="button" data-act="stab" data-val="${k}" aria-pressed="${sTab === k}">${l} (${groups[k].length})</button>`).join("")}</div>
      ${list.length ? list.map(sProposalCard).join("") : `<div class="panel empty-cta"><p>${!S.listings.length ? `Anuncie um lote para começar a receber propostas. <a href="#novo">Anunciar agora</a>` : sTab === "pendentes" ? "Nenhuma proposta esperando sua resposta." : "Nada por aqui ainda."}</p></div>`}`;
  }

  function sProposalCard(p) {
    const l = listing(p.listingId);
    const diff = (p.price / l.price - 1) * 100;
    const actions = p.status === "enviada" ? `
      <div class="prop-actions">
        <button class="btn btn-sm" type="button" data-act="accept" data-id="${p.id}">Aceitar ${money(p.price)}/${per(l.product)}</button>
        ${p.price < l.price ? `<form class="inline-form" data-form="counter" data-id="${p.id}"><div class="money-input sm"><em>R$</em><input name="counter" inputmode="decimal" required value="${num(roundPrice((p.price + l.price) / 2), 2)}" aria-label="Valor da contraproposta"></div><button class="btn btn-sm btn-ghost">Contrapropor</button></form>` : ""}
        <button class="link-btn danger" type="button" data-act="decline" data-id="${p.id}">Recusar</button>
      </div>` : p.status === "contraproposta" ? `<p class="muted">Você contrapropôs ${money(p.counter)}/${per(l.product)}. Aguardando o comprador.</p>`
      : p.status === "aceita" || p.status === "concluida" ? `${contacts(p.buyer, "Contato do comprador")}<a class="link-arrow" href="#negocios">Acompanhar em Negócios →</a>` : "";
    return `<article class="panel prop">
      <header><div><b>${esc(p.buyer.company)}</b><span class="muted">${esc(p.buyer.name)} · ${esc(p.buyer.city || "")}${p.buyer.uf ? `/${esc(p.buyer.uf)}` : ""} · ${ago(p.created)}</span></div>${pill(p.status)}</header>
      <div class="prop-grid">
        <div><span>Produto</span><b>${esc(PRODUCTS[l.product].name)}</b></div>
        <div><span>Quantidade</span><b>${qtyTag(l.product, p.qty)}</b><small>de ${qtyTag(l.product, l.qty)}</small></div>
        <div><span>Preço oferecido</span><b>${money(p.final || p.price)}/${per(l.product)}</b><small class="${diff < -0.5 ? "neg" : "pos"}">${Math.abs(diff) < 0.5 ? "igual ao anunciado" : `${diff > 0 ? "+" : "−"}${num(Math.abs(diff), 1)}% vs seu preço`}</small></div>
        <div><span>Total</span><b>${money(lotValue(l.product, p.qty, p.final || p.price))}</b><small>${esc(p.payment)} · ${esc(D.delivery[p.delivery])}</small></div>
      </div>
      ${thread(p)}${actions}
    </article>`;
  }

  // ---------------- negócios
  function sDeals() {
    const deals = sellerProposals().filter((p) => p.status === "aceita" || p.status === "concluida").sort((a, b) => b.acceptedAt - a.acceptedAt);
    if (!deals.length) return `<h2>Negócios</h2><div class="panel empty-cta"><p>Quando você aceitar uma proposta, o negócio aparece aqui com cada etapa até o pagamento.</p></div>`;
    return `<h2>Negócios</h2>${deals.map((p) => {
      const l = listing(p.listingId);
      return `<article class="panel deal-track">
        <header><div><b>${esc(PRODUCTS[l.product].name)} · ${qtyTag(l.product, p.qty)}</b><span class="muted">${esc(p.buyer.company)} · ${money(p.final)}/${per(l.product)} · total ${money(lotValue(l.product, p.qty, p.final))}</span></div>${pill(p.status)}</header>
        ${stages(p, "seller")}
        ${contacts(p.buyer, "Contato do comprador")}
      </article>`; }).join("")}`;
  }

  // ---------------- fazenda
  let confirmReset = false;
  function sFarm() {
    const f = S.producer;
    return `<h2>Minha fazenda</h2>
      <form class="panel" data-form="farm" novalidate><div class="form-grid">
        <label class="field"><span>Nome da propriedade</span><input name="farm" required value="${esc(f.farm)}"></label>
        <label class="field"><span>Responsável</span><input name="name" required value="${esc(f.name)}"></label>
        <label class="field"><span>Município</span><input name="city" required value="${esc(f.city)}"></label>
        <label class="field"><span>UF</span><select name="uf">${D.ufs.map((u) => `<option ${f.uf === u ? "selected" : ""}>${u}</option>`).join("")}</select></label>
        <label class="field"><span>E-mail</span><input type="email" name="email" required value="${esc(f.email)}"></label>
        <label class="field"><span>WhatsApp</span><input name="phone" required value="${esc(f.phone)}"></label>
        <label class="field"><span>Área produtiva (ha)</span><input name="area" value="${esc(f.area)}"></label>
        <div class="field full"><span>Certificações</span><div class="chips" data-chips="certs">${D.certifications.map((c) => `<button type="button" class="chip" aria-pressed="${(f.certs || []).includes(c)}" data-val="${esc(c)}">${esc(c)}</button>`).join("")}</div></div>
      </div><button class="btn" type="submit">Salvar</button> <span class="ok-msg" data-ok></span><p class="err-msg" data-err></p></form>
      <div class="panel"><h3>Verificação</h3><p>Produtores verificados recebem o selo ✓ e aparecem primeiro na vitrine. Na versão completa, a verificação usa CAR, inscrição estadual e uma nota fiscal recente.</p></div>
      <div class="panel"><h3>Reiniciar demonstração</h3><p class="muted">Apaga a conta, os anúncios e as propostas guardados neste navegador.</p>
        <button class="btn btn-sm btn-ghost danger" type="button" data-act="reset">${confirmReset ? "Clique de novo para confirmar" : "Apagar tudo e recomeçar"}</button></div>`;
  }

  // ================================================================ COMPRADOR
  let filters = { q: "", cat: "", uf: "", cert: "", delivery: "", sort: "recentes" };
  function buyer(view, arg) {
    const tabs = `<nav class="tabs mp-tabs" aria-label="Comprar">
      <a href="#vitrine" ${view === "vitrine" || view === "anuncio" ? 'aria-current="page"' : ""}>Vitrine</a>
      <a href="#propostas" ${view === "propostas" ? 'aria-current="page"' : ""}>Minhas propostas <i data-badge hidden></i></a>
      <a class="tab-right" href="${page("/painel")}">É produtor? Anuncie seu lote →</a></nav>`;
    const views = { vitrine: bShowcase, anuncio: bDetail, propostas: bProposals };
    return tabs + (views[view] || bShowcase)(arg);
  }

  function filtered() {
    const q = fold(filters.q);
    let ls = listings().filter((l) => l.status === "ativo"
      && (!q || fold(`${PRODUCTS[l.product].name} ${l.spec} ${l.producer.name} ${l.city}`).includes(q))
      && (!filters.cat || PRODUCTS[l.product].category_slug === filters.cat)
      && (!filters.uf || l.uf === filters.uf)
      && (!filters.cert || l.certs.includes(filters.cert))
      && (!filters.delivery || l.delivery === filters.delivery));
    const sorters = {
      recentes: (a, b) => b.created - a.created,
      preco: (a, b) => vsRef(a.product, a.price) - vsRef(b.product, b.price),
      volume: (a, b) => lotValue(b.product, b.qty, b.price) - lotValue(a.product, a.qty, a.price),
    };
    return ls.sort(sorters[filters.sort]);
  }

  function bShowcase() {
    const cats = [...new Map(D.products.map((p) => [p.category_slug, p.category])).entries()];
    const ufs = [...new Set(listings().map((l) => l.uf))].sort();
    const sel = (name, label, opts) => `<label class="field"><span>${label}</span><select name="${name}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${filters[name] === v ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
    return `<form class="filter-bar" data-form="filters" onsubmit="return false">
        <label class="field grow"><span>Buscar</span><input type="search" name="q" value="${esc(filters.q)}" placeholder="Produto, fazenda ou cidade…"></label>
        ${sel("cat", "Categoria", [["", "Todas"], ...cats])}
        ${sel("uf", "Estado", [["", "Todos"], ...ufs.map((u) => [u, u])])}
        ${sel("cert", "Certificação", [["", "Qualquer"], ...D.certifications.map((c) => [c, c])])}
        ${sel("delivery", "Entrega", [["", "Qualquer"], ...Object.entries(D.delivery)])}
        ${sel("sort", "Ordenar", [["recentes", "Mais recentes"], ["preco", "Melhor preço vs. referência"], ["volume", "Maior lote"]])}
      </form>
      <div data-results>${results()}</div>`;
  }

  function results() {
    const ls = filtered();
    return `<p class="muted">${ls.length} lote${ls.length === 1 ? "" : "s"} disponíve${ls.length === 1 ? "l" : "is"}</p>
      ${ls.length ? `<div class="lot-grid">${ls.map(listingCard).join("")}</div>` : `<p class="empty-state">Nenhum lote com esses filtros.</p>`}`;
  }

  function bDetail(id) {
    const l = listing(id);
    if (!l) return `<div class="panel empty-cta"><p>Este lote não está mais disponível.</p><a class="btn" href="#vitrine">Voltar à vitrine</a></div>`;
    const p = PRODUCTS[l.product], prod = l.producer;
    const mineOpen = buyerProposals().find((x) => x.listingId === l.id && ["enviada", "contraproposta", "aceita"].includes(x.status));
    const b = S.buyer || {};
    const box = l.owner === "me" ? `<p class="note">Este é o seu anúncio. É assim que os compradores o veem. <a href="${page("/painel")}#anuncios">Gerenciar no painel</a></p>`
      : l.status !== "ativo" ? `<p class="note">Este lote não está recebendo propostas no momento.</p>`
      : mineOpen ? `<p class="note">Você já tem uma proposta neste lote: ${pill(mineOpen.status)} <a href="#propostas">Ver proposta</a></p>`
      : `<form data-form="proposal" data-id="${esc(l.id)}" novalidate>
          <h3>Fazer proposta</h3>
          <div class="form-grid">
            <label class="field"><span>Quantidade (${unit(l.product).qty})</span><input name="qty" inputmode="decimal" required value="${esc(num(Math.max(l.min_qty || 0, Math.min(l.qty, l.qty * 0.25)), 1))}" data-live="prop"></label>
            <label class="field"><span>Preço (${esc(unit(l.product).price)})</span><input name="price" inputmode="decimal" required value="${esc(num(l.price, 2))}" data-live="prop" ${l.accepts_offers ? "" : "readonly"}></label>
            <label class="field"><span>Entrega</span><select name="delivery">${Object.entries(D.delivery).map(([k, t]) => `<option value="${k}" ${k === l.delivery ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
            <label class="field"><span>Pagamento</span><select name="payment"><option>À vista na entrega</option><option>30 dias</option><option>50% antecipado</option></select></label>
            <label class="field full"><span>Mensagem ao produtor</span><textarea name="message" rows="2" placeholder="Ex.: preciso de amostra, prazo de retirada…"></textarea></label>
          </div>
          <fieldset class="who-buys"><legend>${S.buyer ? `Comprando como <b>${esc(b.company)}</b> <button class="link-btn" type="button" data-act="edit-buyer">alterar</button>` : "Seus dados (vão para o produtor só se ele aceitar)"}</legend>
            <div class="form-grid" ${S.buyer ? "hidden" : ""} data-buyer-fields>
              <label class="field"><span>Nome</span><input name="b_name" value="${esc(b.name)}" autocomplete="name"></label>
              <label class="field"><span>Empresa</span><input name="b_company" value="${esc(b.company)}" autocomplete="organization"></label>
              <label class="field"><span>E-mail</span><input type="email" name="b_email" value="${esc(b.email)}" autocomplete="email"></label>
              <label class="field"><span>Telefone</span><input name="b_phone" value="${esc(b.phone)}" autocomplete="tel"></label>
              <label class="field"><span>Cidade</span><input name="b_city" value="${esc(b.city)}"></label>
              <label class="field"><span>UF</span><select name="b_uf">${D.ufs.map((u) => `<option ${(b.uf || "SP") === u ? "selected" : ""}>${u}</option>`).join("")}</select></label>
            </div>
            ${S.buyer ? "" : `<button class="link-btn" type="button" data-act="buyer-example">Preencher com dados de exemplo</button>`}
          </fieldset>
          <p class="lot-total" data-prop-total></p>
          <div class="cta-col"><button class="btn" type="submit">Enviar proposta</button>
            <button class="btn btn-ghost" type="button" data-act="buy-now">Comprar pelo preço anunciado</button></div>
          <p class="err-msg" data-err></p>
          <p class="muted">Sem comissão na demonstração. O contato do produtor é liberado quando ele aceitar.</p>
        </form>`;
    return `<p class="crumb"><a href="#vitrine">← Vitrine</a> / ${esc(p.category)} / ${esc(p.name)}</p>
      <div class="lot-detail">
        <div>
          <div class="gallery"><img class="g-main" src="${esc(photoOf(l))}" alt="${esc(p.name)}">
            ${l.photos?.length > 1 ? `<div class="g-thumbs">${l.photos.map((ph, i) => `<button type="button" data-act="thumb" data-src="${esc(ph)}"><img src="${esc(ph)}" alt="Foto ${i + 1}"></button>`).join("")}</div>` : ""}</div>
          <div class="lot-head"><span class="lot-cat">${esc(p.category)} · NCM ${esc(p.ncm)}</span><h2>${esc(p.name)}</h2><p class="lead">${esc(l.spec)}</p>${certChips(l.certs)}</div>
          ${l.description ? `<div class="panel"><h3>Sobre o lote</h3><p>${esc(l.description)}</p></div>` : ""}
          <div class="panel"><h3>Ficha do lote</h3><dl class="sum">
            <dt>Safra</dt><dd>${esc(l.harvest)}</dd>
            <dt>Disponível</dt><dd>${qtyTag(l.product, l.qty)}</dd>
            <dt>Lote mínimo</dt><dd>${l.min_qty ? qtyTag(l.product, l.min_qty) : "—"}</dd>
            <dt>Entrega</dt><dd>${esc(D.delivery[l.delivery])}</dd>
            <dt>Local da carga</dt><dd>${esc(l.city)}/${esc(l.uf)}</dd>
            ${l.available ? `<dt>A partir de</dt><dd>${dateBR(l.available)}</dd>` : ""}
            <dt>Publicado</dt><dd>${ago(l.created)} · ${num(viewsOf(l))} visualizações</dd>
          </dl></div>
          <div class="panel producer-card"><span class="avatar">${esc(prod.name.slice(0, 1))}</span>
            <div><b>${esc(prod.name)}${prod.verified ? ` <span class="vtag">✓ verificado</span>` : ""}</b>
              <span>${esc(prod.owner)} · ${esc(prod.city)}/${esc(prod.uf)}</span>
              <span>${stars(prod.rating)} · ${prod.deals} negócios concluídos · na plataforma desde ${prod.since}</span></div></div>
        </div>
        <aside class="buy-box panel">
          <div class="bb-price">${priceTag(l.product, l.price)}</div>
          <p class="muted">${qtyTag(l.product, l.qty)} disponíveis · lote de ${money(lotValue(l.product, l.qty, l.price))}</p>
          ${meter(l.product, l.price)}
          ${box}
        </aside>
      </div>`;
  }

  let bTab = "abertas";
  function bProposals() {
    const all = buyerProposals().sort((a, b) => b.created - a.created);
    if (!all.length) return `<div class="panel empty-cta"><h3>Você ainda não fez propostas</h3><p>Escolha um lote na vitrine e envie sua proposta. A resposta do produtor aparece aqui.</p><a class="btn" href="#vitrine">Ver a vitrine</a></div>`;
    const groups = {
      abertas: all.filter((p) => ["enviada", "contraproposta"].includes(p.status)),
      andamento: all.filter((p) => p.status === "aceita"),
      encerradas: all.filter((p) => ["concluida", "recusada", "cancelada"].includes(p.status)),
    };
    const list = groups[bTab];
    return `<div class="toggle-group">${[["abertas", "Em aberto"], ["andamento", "Compras em andamento"], ["encerradas", "Encerradas"]].map(([k, t]) => `<button type="button" data-act="btab" data-val="${k}" aria-pressed="${bTab === k}">${t} (${groups[k].length})</button>`).join("")}</div>
      ${list.length ? list.map(bProposalCard).join("") : `<div class="panel empty-cta"><p>Nada por aqui.</p></div>`}`;
  }

  function bProposalCard(p) {
    const l = listing(p.listingId);
    if (!l) return "";
    const price = p.final || p.price;
    let extra = "";
    if (p.status === "enviada") extra = `<p class="muted waiting">${l.owner === "me" ? "Responda no seu Painel do produtor." : "O produtor foi avisado e costuma responder em minutos."}</p>
      <button class="link-btn danger" type="button" data-act="cancel" data-id="${p.id}">Cancelar proposta</button>`;
    if (p.status === "contraproposta") extra = `<div class="prop-actions"><button class="btn btn-sm" type="button" data-act="take-counter" data-id="${p.id}">Aceitar ${money(p.counter)}/${per(l.product)}</button><button class="link-btn danger" type="button" data-act="refuse-counter" data-id="${p.id}">Recusar</button></div>`;
    if (p.status === "aceita" || p.status === "concluida") extra = `${contacts(contactOf(l.producer), `Contato de ${esc(l.producer.name)}`)}${stages(p, "buyer")}`;
    return `<article class="panel prop">
      <header><a class="prop-lot" href="#anuncio/${esc(l.id)}"><img src="${esc(photoOf(l))}" alt=""><div><b>${esc(PRODUCTS[l.product].name)}</b><span class="muted">${esc(l.producer.name)} · ${esc(l.city)}/${esc(l.uf)}</span></div></a>${pill(p.status)}</header>
      <div class="prop-grid">
        <div><span>Quantidade</span><b>${qtyTag(l.product, p.qty)}</b></div>
        <div><span>${p.final ? "Preço fechado" : "Sua oferta"}</span><b>${money(price)}/${per(l.product)}</b><small>anunciado a ${money(l.price)}</small></div>
        <div><span>Total</span><b>${money(lotValue(l.product, p.qty, price))}</b></div>
        <div><span>Condições</span><b>${esc(p.payment)}</b><small>${esc(D.delivery[p.delivery])}</small></div>
      </div>
      ${thread(p)}${extra}
    </article>`;
  }

  // ================================================================ EVENTOS
  const valX = (s) => {
    let t = String(s ?? "").trim().replace(/\s/g, "");
    if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
    return parseFloat(t);
  };
  const errOut = (form, msg) => { const e = form.querySelector("[data-err]"); if (e) e.textContent = msg; return false; };
  const chipsVal = (root, name) => [...root.querySelectorAll(`[data-chips="${name}"] .chip[aria-pressed="true"]`)].map((c) => c.dataset.val);

  app.addEventListener("click", async (e) => {
    const chip = e.target.closest("[data-chips] .chip");
    if (chip) { chip.setAttribute("aria-pressed", chip.getAttribute("aria-pressed") !== "true"); return; }
    const cat = e.target.closest("[data-pick-cat] .chip");
    if (cat) {
      cat.parentNode.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", c === cat));
      filterPick(); return;
    }
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act, id = btn.dataset.id;
    const prop = id && S.proposals.find((p) => p.id === id);
    switch (act) {
      case "onb-example": onb.data = { ...EXAMPLE_PRODUCER }; onb.step = 1; render(); break;
      case "onb-back": onb.data = { ...onb.data, ...Object.fromEntries(new FormData(btn.form)), certs: chipsVal(app, "certs") }; onb.step = 1; render(); break;
      case "pick": S.draft.product = btn.dataset.slug; S.draft.step = 2; save(); render(); toTop(); break;
      case "wiz-go": stashDraft(); S.draft.step = +btn.dataset.step; save(); render(); toTop(); break;
      case "wiz-reset": S.draft = newDraft(); save(); render(); break;
      case "wiz-example": {
        const ex = D.listings.find((l) => l.product === S.draft.product);
        Object.assign(S.draft, { spec: ex.spec, harvest: ex.harvest, qty: String(Math.round(ex.qty * 0.6)), min_qty: String(ex.min_qty), description: ex.description, certs: ex.certs, price: String(ex.price) });
        save(); render(); break;
      }
      case "photo-del": S.draft.photos.splice(+btn.dataset.i, 1); save(); render(); break;
      case "publish": publish(); break;
      case "toggle": case "sold": case "delete": listingAction(act, id, btn); break;
      case "stab": sTab = btn.dataset.val; render(); break;
      case "btab": bTab = btn.dataset.val; render(); break;
      case "accept": accept(prop, "produtor", prop.price); save(); toast("Proposta aceita. Contatos liberados."); render(); break;
      case "decline": prop.status = "recusada"; log(prop, "produtor", "Proposta recusada pelo produtor."); save(); render(); break;
      case "advance": {
        if (prop.status === "aceita") {
          prop.stage += 1;
          log(prop, MODE === "seller" ? "produtor" : "comprador", `Etapa concluída: ${STAGES[prop.stage]}.`);
          if (prop.stage >= STAGES.length - 1) prop.status = "concluida";
          if (prop.status === "concluida" && listing(prop.listingId)?.owner === "me") toast("Venda concluída!");
          save(); render();
        }
        break;
      }
      case "cancel": prop.status = "cancelada"; log(prop, "comprador", "Proposta cancelada pelo comprador."); save(); render(); break;
      case "take-counter": accept(prop, "comprador", prop.counter); bTab = "andamento"; save(); toast("Negócio fechado. Contatos liberados."); render(); break;
      case "refuse-counter": prop.status = "recusada"; log(prop, "comprador", "Contraproposta recusada."); save(); render(); break;
      case "edit-buyer": { const f = app.querySelector("[data-buyer-fields]"); f.hidden = !f.hidden; break; }
      case "buyer-example": {
        const form = btn.closest("form");
        Object.entries({ b_name: "Camila Torres", b_company: "Empório Sabor da Terra", b_email: "camila@saborterra.com.br", b_phone: "(11) 98877-6655", b_city: "São Paulo", b_uf: "SP" })
          .forEach(([k, v]) => { form.elements[k].value = v; });
        break;
      }
      case "buy-now": { const form = btn.closest("form"); form.elements.price.value = num(listing(form.dataset.id).price, 2); form.requestSubmit(); break; }
      case "thumb": app.querySelector(".g-main").src = btn.dataset.src; break;
      case "reset":
        if (!confirmReset) { confirmReset = true; render(); setTimeout(() => { confirmReset = false; }, 5000); break; }
        try { localStorage.removeItem(KEY); } catch { /* sem storage */ }
        S = blank(); onb = { step: 1, data: {} }; confirmReset = false; location.hash = ""; render(); break;
    }
  });

  function listingAction(act, id, btn) {
    const l = S.listings.find((x) => x.id === id);
    if (!l) return;
    if (act === "toggle") l.status = l.status === "ativo" ? "pausado" : "ativo";
    if (act === "sold") l.status = "vendido";
    if (act === "delete") {
      if (btn.dataset.confirm !== "1") { btn.dataset.confirm = "1"; btn.textContent = "Confirmar exclusão"; return; }
      S.listings = S.listings.filter((x) => x.id !== id);
      S.proposals = S.proposals.filter((p) => p.listingId !== id);
    }
    save(); render();
  }

  function stashDraft() {
    const form = app.querySelector('[data-form="wiz"]');
    if (!form || !S.draft) return;
    const f = Object.fromEntries(new FormData(form));
    Object.assign(S.draft, f);
    if (form.querySelector('[data-chips="certs"]')) S.draft.certs = chipsVal(form, "certs");
    if ("accepts_offers" in form.elements) S.draft.accepts_offers = form.elements.accepts_offers.checked;
  }

  function publish() {
    const d = S.draft;
    const fields = { product: d.product, spec: d.spec.trim(), harvest: d.harvest.trim(), qty: val(d.qty), min_qty: val(d.min_qty) || 0,
      available: d.available, city: d.city.trim(), uf: d.uf, certs: d.certs, description: d.description.trim(), price: val(d.price),
      delivery: d.delivery, accepts_offers: d.accepts_offers, photos: d.photos };
    let l;
    if (d.editId) {
      l = S.listings.find((x) => x.id === d.editId);
      Object.assign(l, fields);
    } else {
      l = { id: uid("m"), ...fields, status: "ativo", created: Date.now(), views: 0 };
      S.listings.unshift(l);
      scheduleDemoBuyers(l);
    }
    S.draft = null;
    if (!save()) {
      // provavelmente fotos grandes demais para o armazenamento do navegador
      l.photos = []; save();
      toast("As fotos não couberam no armazenamento do navegador; publicamos com a imagem ilustrativa.");
    }
    location.hash = d.editId ? "#anuncios" : `#publicado/${l.id}`;
    if (d.editId) toast("Anúncio atualizado.");
  }

  app.addEventListener("submit", (e) => {
    const form = e.target.closest("form[data-form]");
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;
    const f = Object.fromEntries(new FormData(form));

    if (kind === "onboarding") {
      if (onb.step === 1) {
        if (!f.name?.trim() || f.name.trim().length < 3) return errOut(form, "Informe seu nome.");
        if (!EMAIL_RE.test(f.email || "")) return errOut(form, "Informe um e-mail válido.");
        if ((f.phone || "").replace(/\D/g, "").length < 10) return errOut(form, "Informe o WhatsApp com DDD.");
        onb.data = { ...onb.data, ...f }; onb.step = 2; render(); toTop(); return;
      }
      if (!f.farm?.trim()) return errOut(form, "Informe o nome da propriedade.");
      if (!f.city?.trim() || !f.uf) return errOut(form, "Informe município e UF.");
      S.producer = { ...onb.data, ...f, certs: chipsVal(form, "certs"), created: Date.now() };
      S.draft = null;
      save(); toast(`Bem-vindo, ${S.producer.name.split(" ")[0]}! Seu painel está pronto.`);
      location.hash = "#inicio"; render(); return;
    }

    if (kind === "farm") {
      if (!f.farm.trim() || !f.name.trim() || !f.city.trim()) return errOut(form, "Preencha nome, responsável e município.");
      if (!EMAIL_RE.test(f.email)) return errOut(form, "E-mail inválido.");
      Object.assign(S.producer, f, { certs: chipsVal(form, "certs") });
      save(); render(); toast("Dados da fazenda salvos."); return;
    }

    if (kind === "wiz") {
      stashDraft();
      const d = S.draft;
      if (d.step === 2) {
        if (!d.spec.trim()) return errOut(form, "Descreva a variedade e a classificação.");
        if (!d.harvest.trim()) return errOut(form, "Informe a safra.");
        if (!(val(d.qty) > 0)) return errOut(form, "Informe a quantidade disponível.");
        if (val(d.min_qty) > val(d.qty)) return errOut(form, "O lote mínimo não pode ser maior que a quantidade.");
        if (!d.city.trim()) return errOut(form, "Informe o município da carga.");
      }
      if (d.step === 3 && !(val(d.price) > 0)) return errOut(form, "Informe o preço.");
      d.step += 1; save(); render(); toTop(); return;
    }

    if (kind === "counter") {
      const p = S.proposals.find((x) => x.id === form.dataset.id);
      const v = val(f.counter);
      if (!(v > 0)) return;
      const l = listing(p.listingId);
      p.status = "contraproposta"; p.counter = v;
      log(p, "produtor", `Contraproposta: ${money(v)}/${per(l.product)}.`);
      if (p.from === "demo") p.dueAt = Date.now() + 7000;
      save(); toast("Contraproposta enviada."); render(); return;
    }

    if (kind === "proposal") {
      const l = listing(form.dataset.id);
      const qty = val(f.qty), price = val(f.price);
      if (!(qty > 0)) return errOut(form, "Informe a quantidade.");
      if (qty > l.qty) return errOut(form, `O lote tem ${qtyTag(l.product, l.qty)}.`);
      if (l.min_qty && qty < l.min_qty) return errOut(form, `O lote mínimo é ${qtyTag(l.product, l.min_qty)}.`);
      if (!(price > 0)) return errOut(form, "Informe o preço.");
      const buyerData = S.buyer && form.querySelector("[data-buyer-fields]").hidden ? S.buyer
        : { name: f.b_name?.trim(), company: f.b_company?.trim(), email: f.b_email?.trim(), phone: f.b_phone?.trim(), city: f.b_city?.trim(), uf: f.b_uf };
      if (!buyerData.name || buyerData.name.length < 3) return errOut(form, "Informe seu nome.");
      if (!buyerData.company) return errOut(form, "Informe a empresa.");
      if (!EMAIL_RE.test(buyerData.email || "")) return errOut(form, "Informe um e-mail válido.");
      if ((buyerData.phone || "").replace(/\D/g, "").length < 10) return errOut(form, "Informe o telefone com DDD.");
      S.buyer = buyerData;
      const p = { id: uid("q"), from: "me", listingId: l.id, buyer: buyerData, qty, price, delivery: f.delivery, payment: f.payment,
        message: f.message?.trim() || "", status: "enviada", created: Date.now(), log: [] };
      log(p, "comprador", p.message || `Proposta de ${qtyTag(l.product, qty)} a ${money(price)}/${per(l.product)}.`);
      if (l.owner === "demo") p.dueAt = Date.now() + 8000;
      S.proposals.push(p);
      save();
      toast(l.owner === "me" ? "Proposta enviada. Responda pelo Painel do produtor." : `Proposta enviada para ${l.producer.name}.`);
      bTab = "abertas"; location.hash = "#propostas";
    }
  });

  app.addEventListener("input", (e) => {
    const t = e.target;
    if (t.matches("[data-pick-q]")) filterPick();
    if (t.closest('[data-form="filters"]')) { filters[t.name] = t.value; app.querySelector("[data-results]").innerHTML = results(); }
    if (t.dataset.live === "price") {
      const price = val(t.value);
      S.draft.price = t.value;
      app.querySelector("[data-total]").innerHTML = totalLine(S.draft);
      if (price > 0) app.querySelector("[data-meter]").innerHTML = meter(S.draft.product, price);
    }
    if (t.dataset.live === "prop") propTotal(t.form);
  });
  app.addEventListener("change", (e) => {
    const t = e.target;
    if (t.closest('[data-form="filters"]')) { filters[t.name] = t.value; app.querySelector("[data-results]").innerHTML = results(); }
    if (t.matches("[data-photo]")) addPhoto(t.files[0]);
  });

  function filterPick() {
    const q = fold(app.querySelector("[data-pick-q]")?.value);
    const cat = app.querySelector('[data-pick-cat] .chip[aria-pressed="true"]')?.dataset.val || "";
    app.querySelectorAll(".pick").forEach((b) => { b.hidden = (q && !b.dataset.q.includes(q)) || (cat && b.dataset.cat !== cat); });
  }

  function propTotal(form) {
    const out = form?.querySelector("[data-prop-total]");
    if (!out) return;
    const l = listing(form.dataset.id), qty = val(form.elements.qty.value), price = val(form.elements.price.value);
    if (!(qty > 0 && price > 0)) { out.textContent = ""; return; }
    const diff = (price / l.price - 1) * 100;
    out.innerHTML = `Total da proposta: <b>${money(lotValue(l.product, qty, price))}</b>${Math.abs(diff) >= 0.5 ? ` · <span class="${diff < 0 ? "neg" : "pos"}">${diff > 0 ? "+" : "−"}${num(Math.abs(diff), 1)}% vs preço anunciado</span>` : ""}`;
  }

  async function addPhoto(file) {
    if (!file) return;
    try {
      const data = await new Promise((resolve, reject) => {
        const img = new Image(), url = URL.createObjectURL(file);
        img.onload = () => {
          const k = Math.min(1, 900 / Math.max(img.width, img.height));
          const c = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          resolve(c.toDataURL("image/jpeg", 0.72));
        };
        img.onerror = () => reject(new Error("Não foi possível ler essa imagem."));
        img.src = url;
      });
      S.draft.photos.push(data);
      save(); render();
    } catch (err) { toast(err.message); }
  }

  function afterRender(view) {
    if (view === "anuncio") propTotal(app.querySelector('[data-form="proposal"]'));
  }

  render();
})();
