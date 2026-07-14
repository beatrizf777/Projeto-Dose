/**
 * Dashboard inicial (funcionário) da D.O.S.E.
 * Monta os gráficos "Mais Vendidos" (produtos por quantidade) e
 * "Valor Total por Categoria" (receita por categoria) a partir do db.json.
 */

const PALETTE = ["#364E72", "#74C2C9", "#7AB1C9", "#5aaeb5", "#A7C957", "#E76F51", "#F4A261", "#9B5DE5"];

const formatadorBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function preencherData() {
    const el = document.getElementById("rodapeData");
    if (el) el.textContent = new Date().toLocaleDateString("pt-BR");
}

async function fetchJSON(route) {
    const response = await fetch(route);
    if (!response.ok && response.status !== 304) {
        throw new Error(`Falha ao buscar ${route} (${response.status})`);
    }
    return response.json();
}

function topProdutosPorQuantidade(saleItems, batches, products, limite = 5) {
    const qtdPorProduto = saleItems.reduce((acc, item) => {
        const batch = batches.find((b) => b.id === item.batch_id);
        if (!batch) return acc;
        acc[batch.product_id] = (acc[batch.product_id] || 0) + item.quantity;
        return acc;
    }, {});

    return Object.entries(qtdPorProduto)
        .map(([productId, quantidade]) => {
            const product = products.find((p) => p.id === Number(productId));
            return { nome: product ? product.name : `#${productId}`, quantidade };
        })
        .sort((a, b) => b.quantidade - a.quantidade)
        .slice(0, limite);
}

function valorPorCategoria(saleItems, batches, products, categories) {
    const nomeCategoria = categories.reduce((acc, c) => {
        acc[c.id] = c.name || c.nome || `Categoria ${c.id}`;
        return acc;
    }, {});

    const valorPorCat = saleItems.reduce((acc, item) => {
        const batch = batches.find((b) => b.id === item.batch_id);
        if (!batch) return acc;
        const product = products.find((p) => p.id === batch.product_id);
        if (!product) return acc;
        const valor = typeof item.total === "number" ? item.total : item.unit_price * item.quantity;
        acc[product.category_id] = (acc[product.category_id] || 0) + valor;
        return acc;
    }, {});

    return Object.entries(valorPorCat)
        .map(([catId, valor]) => ({ nome: nomeCategoria[catId] || `Categoria ${catId}`, valor }))
        .sort((a, b) => b.valor - a.valor);
}

function renderDoughnut(canvasId, labels, data, labelDataset) {
    return new Chart(document.getElementById(canvasId), {
        type: "doughnut",
        data: {
            labels,
            datasets: [{ label: labelDataset, data, backgroundColor: PALETTE, borderWidth: 0, hoverOffset: 6 }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "55%",
            plugins: { legend: { position: "bottom", labels: { color: "#364E72", boxWidth: 12, font: { size: 11 } } } },
        },
    });
}

function renderPie(canvasId, labels, data, labelDataset) {
    return new Chart(document.getElementById(canvasId), {
        type: "pie",
        data: {
            labels,
            datasets: [{ label: labelDataset, data, backgroundColor: PALETTE, borderWidth: 0, hoverOffset: 6 }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: "bottom", labels: { color: "#364E72", boxWidth: 12, font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.label}: ${formatadorBRL.format(ctx.parsed)}`,
                    },
                },
            },
        },
    });
}

// Gráficos só ficam nítidos para Gerente; demais cargos veem desfocado
function aplicarBlurSeNaoGerente() {
    let role = null;
    try {
        role = (JSON.parse(sessionStorage.getItem("usuarioCorrente")) || {}).role;
    } catch (_) { /* sem sessão */ }
    if (role === "Gerente") return;

    ["topProductsChart", "valueByCategoryChart"].forEach((id) => {
        const canvas = document.getElementById(id);
        if (canvas) {
            canvas.style.filter = "blur(7px)";
            canvas.style.pointerEvents = "none";
        }
    });
}

/* ===================== PAINEL DE ALERTAS ===================== */
const LOW_STOCK_THRESHOLD = 25; // unidades
const EXPIRY_MONTHS = 3;        // alerta se vence dentro de 3 meses
const ALERTS_MAX_VISIBLE = 3;   // itens por card antes do "VER MAIS"

let alertasCache = null;

function formatarDataBR(iso) {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR");
}

function calcularAlertas(batches, products) {
    const estoque = batches.reduce((acc, b) => {
        acc[b.product_id] = (acc[b.product_id] || 0) + (b.quantity || 0);
        return acc;
    }, {});

    const baixoEstoque = products
        .map((p) => ({ nome: p.name, qtd: estoque[p.id] || 0 }))
        .filter((x) => x.qtd <= LOW_STOCK_THRESHOLD)
        .sort((a, b) => a.qtd - b.qtd);

    const hoje = new Date();
    const limite = new Date();
    limite.setMonth(limite.getMonth() + EXPIRY_MONTHS);

    const validade = batches
        .map((b) => {
            const venc = new Date(b.valid_until);
            const dias = Math.round((venc - hoje) / 86400000);
            const p = products.find((x) => x.id === b.product_id);
            return { nome: p ? p.name : `Produto ${b.product_id}`, lote: b.batch_identifier, venc: b.valid_until, dias };
        })
        .filter((x) => new Date(x.venc) <= limite)
        .sort((a, b) => a.dias - b.dias);

    return { baixoEstoque, validade };
}

function linhaEstoqueHTML(item) {
    return `<div class="flex justify-between items-center gap-2 border border-[#7AB1C9]/30 rounded-lg px-2.5 py-1.5">
        <span class="text-[#364E72]">${item.nome}</span>
        <span class="font-bold text-[#FF422D] whitespace-nowrap">${item.qtd} un</span>
    </div>`;
}

function linhaValidadeHTML(item) {
    const txt = item.dias < 0 ? `vencido há ${Math.abs(item.dias)} dias` : `faltam ${item.dias} dias`;
    return `<div class="border border-[#7AB1C9]/30 rounded-lg px-2.5 py-1.5">
        <p class="font-semibold text-[#364E72]">${item.nome}</p>
        <p class="text-xs text-[#364E72]/70">Lote ${item.lote} · vence ${formatarDataBR(item.venc)} (${txt})</p>
    </div>`;
}

function cardAlertaHTML(titulo, cor, itens, linhaFn, vazioTxt) {
    const corpo = itens.length === 0
        ? `<p class="text-xs text-[#7AB1C9] italic">${vazioTxt}</p>`
        : itens.slice(0, ALERTS_MAX_VISIBLE).map(linhaFn).join("");
    const verMais = itens.length > ALERTS_MAX_VISIBLE
        ? `<button class="ver-mais-alertas text-xs font-semibold text-[#5aaeb5] hover:text-[#364E72]">VER MAIS (${itens.length})</button>`
        : "";
    return `<div class="bg-white rounded-2xl shadow-sm border border-[#7AB1C9]/30 overflow-hidden flex flex-col">
        <div class="px-4 py-2 text-white text-xs font-bold uppercase tracking-wider" style="background:${cor}">${titulo}</div>
        <div class="p-3 flex flex-col gap-2 flex-1">${corpo}</div>
        <div class="px-3 pb-3 text-right">${verMais}</div>
    </div>`;
}

function renderAlertas(alertas) {
    alertasCache = alertas;
    const panel = document.getElementById("alertsPanel");
    if (!panel) return;
    panel.innerHTML =
        cardAlertaHTML("Alerta de Baixo Estoque", "#FF422D", alertas.baixoEstoque, linhaEstoqueHTML, "Nenhum produto com estoque baixo.") +
        cardAlertaHTML("Validade Próxima", "#E8830C", alertas.validade, linhaValidadeHTML, "Nenhum lote vencendo em breve.");
    panel.querySelectorAll(".ver-mais-alertas").forEach((b) =>
        b.addEventListener("click", abrirPopupAlertas)
    );
}

function abrirPopupAlertas() {
    if (!alertasCache || document.getElementById("dose-alerts-overlay")) return;
    const a = alertasCache;
    const estoqueRows = a.baixoEstoque.length ? a.baixoEstoque.map(linhaEstoqueHTML).join("") : `<p class="text-xs text-[#7AB1C9] italic">Nenhum.</p>`;
    const validadeRows = a.validade.length ? a.validade.map(linhaValidadeHTML).join("") : `<p class="text-xs text-[#7AB1C9] italic">Nenhum.</p>`;

    const overlay = document.createElement("div");
    overlay.id = "dose-alerts-overlay";
    overlay.setAttribute("style",
        "position:fixed;inset:0;z-index:99999;background:rgba(54,78,114,.4);" +
        "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;" +
        "align-items:center;justify-content:center;padding:16px;");
    overlay.innerHTML = `
        <div class="bg-white rounded-2xl shadow-xl border border-[#7AB1C9]/30 w-full max-w-lg max-h-[85vh] flex flex-col">
            <div class="flex items-center justify-between px-5 py-3 border-b border-[#7AB1C9]/30">
                <h2 class="font-bold text-[#364E72]">Painel de Alertas</h2>
                <button id="dose-alerts-close" class="text-[#7AB1C9] hover:text-[#364E72] text-2xl leading-none">&times;</button>
            </div>
            <div class="p-5 overflow-y-auto flex flex-col gap-5">
                <div>
                    <h3 class="text-xs font-bold uppercase tracking-wider mb-2" style="color:#FF422D">Baixo Estoque (${a.baixoEstoque.length})</h3>
                    <div class="flex flex-col gap-2">${estoqueRows}</div>
                </div>
                <div>
                    <h3 class="text-xs font-bold uppercase tracking-wider mb-2" style="color:#E8830C">Validade Próxima (${a.validade.length})</h3>
                    <div class="flex flex-col gap-2">${validadeRows}</div>
                </div>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    const fechar = () => overlay.remove();
    document.getElementById("dose-alerts-close").addEventListener("click", fechar);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) fechar(); });
}

async function initDashboard() {
    preencherData();
    aplicarBlurSeNaoGerente();

    try {
        const [saleItems, batches, products, categories] = await Promise.all([
            fetchJSON("/saleItems"),
            fetchJSON("/batches"),
            fetchJSON("/products"),
            fetchJSON("/categories"),
        ]);

        const topProdutos = topProdutosPorQuantidade(saleItems, batches, products);
        renderDoughnut("topProductsChart", topProdutos.map((p) => p.nome), topProdutos.map((p) => p.quantidade), "Quantidade vendida");

        const valores = valorPorCategoria(saleItems, batches, products, categories);
        renderPie("valueByCategoryChart", valores.map((v) => v.nome), valores.map((v) => v.valor), "Valor vendido");

        renderAlertas(calcularAlertas(batches, products));
    } catch (error) {
        console.error("Erro ao montar o dashboard:", error);
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDashboard);
} else {
    initDashboard();
}
