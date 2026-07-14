// Trabalho Interdisciplinar 1 - Aplicações Web
//
// Módulo de registro/login de usuários para aplicação com backend JSON Server.
// Adaptado para a D.O.S.E.: usuários têm is_worker (funcionário x cliente),
// role (cargo na farmácia) e company_id (farmácia à qual pertencem).
//
// Uso do gate nas páginas:
//   <script src="/assets/js/login.js" data-require="worker"></script>  -> exige funcionário logado
//   <script src="/assets/js/login.js" data-require="auth"></script>    -> exige qualquer usuário logado
//   <script src="/assets/js/login.js"></script>                        -> sem gate (ex.: a própria página de login)

const LOGIN_URL = "/modulos/login/login.html";
const WORKER_HOME = "/index.html";
const CLIENT_HOME = "/modulos/Beatriz/farmacias/index.html";
const USUARIOS_URL = "/usuarios";
const COMPANIES_URL = "/companies";

const SCRIPT_EL = document.currentScript;
const REQUIRE = SCRIPT_EL ? SCRIPT_EL.dataset.require : undefined; // "worker" | "auth" | undefined

var db_usuarios = {};
var usuarioCorrente = {};

function getSession() {
    const raw = sessionStorage.getItem("usuarioCorrente");
    return raw ? JSON.parse(raw) : null;
}

function homeForUser(user) {
    return user && user.is_worker ? WORKER_HOME : CLIENT_HOME;
}

// Inicializa a aplicação de Login / aplica o gate de acesso
function initLoginApp() {
    const pagina = window.location.pathname;

    // Página de login: apenas carrega a base de usuários
    if (pagina === LOGIN_URL) {
        carregarUsuarios(() => console.log("Usuários carregados..."));
        return;
    }

    // Demais páginas
    const sessao = getSession();
    if (sessao) usuarioCorrente = sessao;

    if (REQUIRE) {
        if (!sessao) {
            // Não logado: guarda destino e manda para o login
            sessionStorage.setItem("returnURL", pagina);
            window.location.href = LOGIN_URL;
            return;
        }
        if (REQUIRE === "worker" && !usuarioCorrente.is_worker) {
            // Logado, mas é cliente tentando página interna: manda para a área do cliente
            window.location.href = CLIENT_HOME;
            return;
        }
        if (REQUIRE === "client" && usuarioCorrente.is_worker) {
            // Logado, mas é funcionário tentando página exclusiva de cliente: manda para o dashboard
            window.location.href = WORKER_HOME;
            return;
        }
        // Restrição por cargo (role): a página declara os cargos permitidos em data-roles
        if (REQUIRE === "worker" && usuarioCorrente.is_worker) {
            const rolesAttr = SCRIPT_EL && SCRIPT_EL.dataset.roles;
            if (rolesAttr) {
                const permitidos = rolesAttr.split(",").map((r) => r.trim());
                if (!permitidos.includes(usuarioCorrente.role)) {
                    mostrarAcessoNegado();
                    return;
                }
            }
        }
    }

    document.addEventListener("DOMContentLoaded", function () {
        showUserInfo("userInfo");
    });
}

function carregarUsuarios(callback) {
    fetch(USUARIOS_URL)
        .then((response) => response.json())
        .then((data) => {
            db_usuarios = data;
            callback();
        })
        .catch((error) => {
            console.error("Erro ao ler usuários via API JSONServer:", error);
        });
}

// Valida login/senha; se ok, salva o usuário corrente na sessão e retorna true
function loginUser(login, senha) {
    for (var i = 0; i < db_usuarios.length; i++) {
        var usuario = db_usuarios[i];
        if (login == usuario.login && senha == usuario.senha) {
            usuarioCorrente = {
                id: usuario.id,
                login: usuario.login,
                email: usuario.email,
                nome: usuario.nome,
                is_worker: !!usuario.is_worker,
                role: usuario.role || null,
                company_id: usuario.company_id ?? null,
            };
            sessionStorage.setItem("usuarioCorrente", JSON.stringify(usuarioCorrente));
            return true;
        }
    }
    return false;
}

// Faz logout e leva para o login
function logoutUser() {
    sessionStorage.removeItem("usuarioCorrente");
    window.location = LOGIN_URL;
}

// Redireciona após login bem-sucedido, respeitando a página de origem e o papel
function redirectAfterLogin() {
    const returnURL = sessionStorage.getItem("returnURL");
    sessionStorage.removeItem("returnURL");
    window.location.href = returnURL || homeForUser(usuarioCorrente);
}

// Cadastra um novo usuário. Funcionário precisa de invite_key válido (define company_id) e cargo.
// Cliente informa apenas dados básicos. Retorna { ok, error }.
async function registerUser({ nome, login, email, senha, isWorker, role, inviteKey }) {
    let company_id = null;

    if (isWorker) {
        let companies;
        try {
            companies = await fetch(COMPANIES_URL).then((r) => r.json());
        } catch (e) {
            return { ok: false, error: "Não foi possível validar a chave de convite." };
        }
        const company = companies.find((c) => c.invite_key && c.invite_key === inviteKey);
        if (!company) {
            return { ok: false, error: "Chave de convite inválida. Confira com a farmácia." };
        }
        company_id = company.id;
    }

    const novoUsuario = {
        login,
        senha,
        nome,
        email,
        is_worker: !!isWorker,
        role: isWorker ? role : null,
        company_id,
    };

    try {
        const response = await fetch(USUARIOS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(novoUsuario),
        });
        if (!response.ok) throw new Error(`status ${response.status}`);
        return { ok: true };
    } catch (e) {
        console.error("Erro ao inserir usuário:", e);
        return { ok: false, error: "Erro ao criar a conta. Tente novamente." };
    }
}

function showUserInfo(element) {
    var elemUser = document.getElementById(element);
    if (elemUser && usuarioCorrente && usuarioCorrente.nome) {
        elemUser.textContent = `${usuarioCorrente.nome} (${usuarioCorrente.login})`;
    }
}

// Popup de acesso negado por cargo: mensagem + contagem de 3s + botão para redirecionar agora
function mostrarAcessoNegado() {
    const destino = homeForUser(usuarioCorrente);

    function render() {
        if (document.getElementById("dose-perm-overlay")) return;

        const overlay = document.createElement("div");
        overlay.id = "dose-perm-overlay";
        overlay.setAttribute("style",
            "position:fixed;inset:0;z-index:99999;background:rgba(54,78,114,.4);" +
            "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;" +
            "align-items:center;justify-content:center;padding:16px;font-family:ui-sans-serif,system-ui,sans-serif;");
        overlay.innerHTML =
            '<div style="background:#fff;border:1px solid rgba(122,177,201,.3);border-radius:16px;' +
            'box-shadow:0 12px 32px rgba(0,0,0,.25);max-width:380px;width:100%;padding:28px;text-align:center;color:#364E72;">' +
            '<div style="width:48px;height:48px;border-radius:9999px;background:rgba(255,66,45,.12);display:flex;' +
            'align-items:center;justify-content:center;margin:0 auto 14px;">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" ' +
            'stroke="#FF422D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></div>' +
            '<h2 style="font-size:18px;font-weight:800;margin:0 0 8px;">Acesso negado</h2>' +
            '<p style="font-size:14px;color:rgba(54,78,114,.8);margin:0 0 6px;">Você não tem permissão para acessar esse conteúdo.</p>' +
            '<p style="font-size:13px;color:#7AB1C9;margin:0 0 18px;">Redirecionando para a home em <span id="dose-perm-count">3</span>s…</p>' +
            '<button id="dose-perm-now" style="background:#74C2C9;color:#fff;font-weight:600;border:none;' +
            'border-radius:12px;padding:11px 18px;cursor:pointer;width:100%;">Redirecionar agora</button>' +
            "</div>";

        document.body.appendChild(overlay);
        document.getElementById("dose-perm-now").addEventListener("click", function () {
            window.location.href = destino;
        });

        let n = 3;
        const countEl = document.getElementById("dose-perm-count");
        const timer = setInterval(function () {
            n -= 1;
            if (countEl) countEl.textContent = String(n);
            if (n <= 0) {
                clearInterval(timer);
                window.location.href = destino;
            }
        }, 1000);
    }

    if (document.body) render();
    else document.addEventListener("DOMContentLoaded", render);
}

// Inicializa o LoginApp
initLoginApp();
