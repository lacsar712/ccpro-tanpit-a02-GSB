import { LitElement, css, html } from "lit";

const TOKEN_KEY = "tanpit_token";
const LABELS = { fill: "注液", tanning: "鞣制中", drained: "已放液" };
const ROLE_LABELS = { admin: "值班长", worker: "操作工" };
const RPM_MIN = 8;
const RPM_MAX = 14;
const RPM_SCALE = 20;

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data.detail;
    const msg = typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg || JSON.stringify(x)).join("；") : "请求失败";
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

class TanYard extends LitElement {
  static properties = {
    ready: { type: Boolean },
    user: { type: Object },
    view: { type: String },
    board: { type: Object },
    picked: { type: Object },
    ph: { type: String },
    cards: { type: Array },
    filterPitId: { type: Number },
    formPitId: { type: Number },
    formCardNo: { type: Number },
    formRpm: { type: Number },
    err: { type: String },
    notice: { type: String },
    username: { type: String },
    password: { type: String },
  };

  static styles = css`
    :host { display: block; font-family: "KaiTi", serif; color: #2b2118; }
    .topbar { display: flex; align-items: center; gap: 14px; background: #3a2c1e; color: #f3e9d8; padding: 10px 18px; }
    .topbar .brand { font-size: 1.15em; font-weight: bold; }
    .topbar nav { display: flex; gap: 6px; flex: 1; }
    .topbar nav button { background: transparent; color: #d8c9ae; border: 1px solid #6b5638; border-radius: 6px; padding: 6px 14px; cursor: pointer; font: inherit; }
    .topbar nav button.on { background: #8a5a2b; color: #fff; border-color: #8a5a2b; }
    .topbar .who { font-size: 0.92em; color: #d8c9ae; }
    .topbar .ghost { background: transparent; color: #d8c9ae; border: 0; cursor: pointer; font: inherit; text-decoration: underline; }
    .wrap { max-width: 880px; margin: 0 auto; padding: 28px 16px 50px; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .pit { min-height: 110px; border-radius: 8px; color: #fff; cursor: pointer; border: 0; font: inherit; }
    .fill { background: #6d8f9e; }
    .tanning { background: #8a5a2b; }
    .drained { background: #5f6f4a; }
    .drawer { position: fixed; top: 0; right: 0; width: 340px; max-width: 90vw; height: 100vh; box-sizing: border-box; background: #fbf5ea; box-shadow: -6px 0 18px rgba(0, 0, 0, 0.28); padding: 22px 20px; overflow-y: auto; z-index: 10; }
    .drawer .close { float: right; border: 0; background: transparent; font-size: 1.3em; cursor: pointer; color: #6b5a48; }
    .drawer ul { padding-left: 18px; margin: 6px 0; }
    .panel { border: 1px solid #d8c9ae; border-radius: 8px; background: #fbf5ea; padding: 16px 18px; margin-bottom: 18px; }
    .err { color: #9b1c1c; }
    .hint { color: #6b5a48; font-size: 0.92em; }
    .ok { color: #2f6b2f; }
    .bad { color: #9b1c1c; }
    label { display: block; margin: 8px 0; }
    input, button, select { font: inherit; padding: 8px 10px; margin: 4px 6px 4px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border-bottom: 1px solid #e2d5bd; padding: 6px 8px; text-align: left; font-size: 0.95em; }
    tr.voided td { color: #a39584; text-decoration: line-through; }
    tr.voided td:last-child { text-decoration: none; }
    .scale { margin: 10px 0 4px; }
    .scale input[type="range"] { width: 100%; margin: 0; }
    .ticks { display: flex; justify-content: space-between; font-size: 0.78em; color: #6b5a48; padding: 0 2px; }
    .ticks span { width: 2ch; text-align: center; }
    .ticks span.in { color: #2f6b2f; font-weight: bold; }
  `;

  constructor() {
    super();
    this.ready = Boolean(localStorage.getItem(TOKEN_KEY));
    this.user = null;
    this.view = "map";
    this.board = null;
    this.picked = null;
    this.ph = "4.2";
    this.cards = [];
    this.filterPitId = 0;
    this.formPitId = 0;
    this.formCardNo = 1;
    this.formRpm = 12;
    this.err = "";
    this.notice = "";
    this.username = "admin";
    this.password = "123456";
  }

  async connectedCallback() {
    super.connectedCallback();
    if (!this.ready) return;
    try {
      this.user = await api("/api/auth/me");
      await this.refresh();
      await this.loadCards();
    } catch (e) {
      if (e.status === 401) this.logout();
      else this.err = e.message;
    }
  }

  async refresh() {
    this.board = await api("/api/board");
    if (this.picked) {
      this.picked = this.board.pits.find((p) => p.id === this.picked.id) || null;
    }
    if (!this.formPitId && this.board.pits.length) {
      this.formPitId = this.board.pits[0].id;
    }
  }

  async loadCards() {
    this.cards = await api("/api/cards");
    this.formCardNo = this.nextCardNo(this.formPitId);
  }

  nextCardNo(pitId) {
    const used = this.cards.filter((c) => c.pitId === pitId).map((c) => c.cardNo);
    return used.length ? Math.max(...used) + 1 : 1;
  }

  async login(e) {
    e.preventDefault();
    this.err = "";
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: this.username, password: this.password }),
      });
      localStorage.setItem(TOKEN_KEY, data.access_token);
      this.user = data.user;
      this.ready = true;
      await this.refresh();
      await this.loadCards();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    this.ready = false;
    this.user = null;
    this.board = null;
    this.picked = null;
    this.cards = [];
    this.err = "";
  }

  async showView(view) {
    this.view = view;
    this.err = "";
    this.notice = "";
    try {
      if (view === "map") await this.refresh();
      if (view === "cards") await this.loadCards();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async writePh() {
    this.err = "";
    try {
      this.picked = await api(`/api/pits/${this.picked.id}/samples`, {
        method: "POST",
        body: JSON.stringify({ ph: Number(this.ph) }),
      });
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async setStatus(status) {
    this.err = "";
    try {
      this.picked = await api(`/api/pits/${this.picked.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  onFormPitChange(e) {
    this.formPitId = Number(e.target.value);
    this.formCardNo = this.nextCardNo(this.formPitId);
  }

  async createCard() {
    this.err = "";
    this.notice = "";
    try {
      const card = await api("/api/cards", {
        method: "POST",
        body: JSON.stringify({ pit_id: this.formPitId, card_no: Number(this.formCardNo), rpm: Number(this.formRpm) }),
      });
      this.notice = `已建卡：${card.pitCode} ${card.cardNo} 号 · ${card.rpm} 转/分`;
      await this.loadCards();
    } catch (ex) {
      this.err = ex.message;
      await this.loadCards().catch(() => {});
    }
  }

  async voidCard(card) {
    this.err = "";
    this.notice = "";
    try {
      await api(`/api/cards/${card.id}/void`, { method: "POST" });
      this.notice = `${card.pitCode} ${card.cardNo} 号卡已作废`;
      await this.loadCards();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  render() {
    if (!this.ready) {
      return html`<div class="wrap">
        <h1>南冈鞣场</h1>
        <form @submit=${this.login} autocomplete="off">
          <label>用户名
            <input name="username" autocomplete="off" .value=${this.username} @input=${(e) => (this.username = e.target.value)} />
          </label>
          <label>密码
            <input name="password" type="password" autocomplete="off" .value=${this.password} @input=${(e) => (this.password = e.target.value)} />
          </label>
          <p class="hint">已预填 admin / 123456（值班长），另有 worker / 123456（操作工）</p>
          <button>登录</button>
        </form>
        ${this.err ? html`<p class="err">${this.err}</p>` : ""}
      </div>`;
    }
    return html`
      <header class="topbar">
        <span class="brand">南冈鞣场</span>
        <nav>
          <button class=${this.view === "map" ? "on" : ""} @click=${() => this.showView("map")}>坑位场地图</button>
          <button class=${this.view === "cards" ? "on" : ""} @click=${() => this.showView("cards")}>转速卡</button>
        </nav>
        <span class="who">${this.user ? `${this.user.username} · ${ROLE_LABELS[this.user.role] || this.user.role}` : ""}</span>
        <button class="ghost" @click=${this.logout}>退出</button>
      </header>
      ${this.view === "map" ? this.renderMap() : this.renderCards()}
    `;
  }

  renderMap() {
    if (!this.board) return html`<div class="wrap">${this.err || "装载坑位…"}</div>`;
    return html`<div class="wrap">
      <p class="hint">${this.board.village} · 点坑登记浸液酸碱度；放液须最近读数 3.5～5.0；注液改鞣制中须未作废转速卡 8～14 转/分</p>
      <div class="grid">
        ${this.board.pits.map(
          (p) => html`<button class="pit ${p.status}" @click=${() => (this.picked = p)}>
            <strong>${p.code}</strong><br />${LABELS[p.status]}
          </button>`
        )}
      </div>
      ${this.picked ? this.renderDrawer() : ""}
      ${this.err && !this.picked ? html`<p class="err">${this.err}</p>` : ""}
    </div>`;
  }

  renderDrawer() {
    const p = this.picked;
    const active = this.cards.filter((c) => c.pitId === p.id && !c.voidedAt);
    const qualified = active.filter((c) => c.rpm >= RPM_MIN && c.rpm <= RPM_MAX);
    return html`<aside class="drawer">
      <button class="close" @click=${() => (this.picked = null)}>×</button>
      <h3>${p.code} · ${LABELS[p.status]}</h3>
      <p>最近酸碱度：${p.latestPh ?? "无"} · ${p.sampleCount} 次</p>
      <input .value=${this.ph} @input=${(e) => (this.ph = e.target.value)} />
      <button @click=${this.writePh}>登记酸碱度</button>
      <div>
        <button @click=${() => this.setStatus("fill")}>注液</button>
        <button @click=${() => this.setStatus("tanning")}>鞣制中</button>
        <button @click=${() => this.setStatus("drained")}>已放液</button>
      </div>
      <h4>转速卡（未作废 ${active.length} 张）</h4>
      ${active.length
        ? html`<ul>
            ${active.map(
              (c) => html`<li>
                ${c.cardNo} 号 · ${c.rpm} 转/分 · ${c.measurer} · ${fmtTime(c.measuredAt)}
                ${c.rpm >= RPM_MIN && c.rpm <= RPM_MAX ? html`<span class="ok">合格</span>` : html`<span class="bad">出区间</span>`}
              </li>`
            )}
          </ul>`
        : html`<p class="hint">暂无转速卡，可到「转速卡」专页建卡</p>`}
      ${qualified.length
        ? html`<p class="ok">合格转数：${qualified[0].rpm} 转/分（${qualified[0].cardNo} 号卡）</p>`
        : html`<p class="bad">无合格转数（须 8～14 转/分），注液不能改鞣制中</p>`}
      ${this.err ? html`<p class="err">${this.err}</p>` : ""}
    </aside>`;
  }

  renderCards() {
    const pits = this.board ? this.board.pits : [];
    const list = this.filterPitId ? this.cards.filter((c) => c.pitId === this.filterPitId) : this.cards;
    const inBand = this.formRpm >= RPM_MIN && this.formRpm <= RPM_MAX;
    return html`<div class="wrap">
      <section class="panel">
        <h2>建转速卡</h2>
        <label>坑位
          <select .value=${String(this.formPitId)} @change=${this.onFormPitChange}>
            ${pits.map((p) => html`<option value=${p.id} ?selected=${p.id === this.formPitId}>${p.code}</option>`)}
          </select>
        </label>
        <label>卡号（从 1 起，同坑未作废不重号）
          <input type="number" min="1" step="1" .value=${String(this.formCardNo)} @input=${(e) => (this.formCardNo = Number(e.target.value))} />
        </label>
        <div class="scale">
          <input type="range" min="1" max=${RPM_SCALE} step="1" list="rpm-ticks" .value=${String(this.formRpm)} @input=${(e) => (this.formRpm = Number(e.target.value))} />
          <datalist id="rpm-ticks">
            ${Array.from({ length: RPM_SCALE }, (_, i) => html`<option value=${i + 1}></option>`)}
          </datalist>
          <div class="ticks">
            ${Array.from({ length: RPM_SCALE }, (_, i) => html`<span class=${i + 1 >= RPM_MIN && i + 1 <= RPM_MAX ? "in" : ""}>${i + 1}</span>`)}
          </div>
        </div>
        <p>
          每分钟转数：<strong>${this.formRpm}</strong> 转/分
          ${inBand ? html`<span class="ok">合格（8～14）</span>` : html`<span class="bad">不在 8～14</span>`}
        </p>
        <button @click=${this.createCard}>建卡</button>
        ${this.notice ? html`<p class="ok">${this.notice}</p>` : ""}
        ${this.err ? html`<p class="err">${this.err}</p>` : ""}
      </section>
      <section class="panel">
        <h2>转速卡列表</h2>
        <label>按坑筛选
          <select .value=${String(this.filterPitId)} @change=${(e) => (this.filterPitId = Number(e.target.value))}>
            <option value="0" ?selected=${this.filterPitId === 0}>全部坑</option>
            ${pits.map((p) => html`<option value=${p.id} ?selected=${p.id === this.filterPitId}>${p.code}</option>`)}
          </select>
        </label>
        <table>
          <thead>
            <tr><th>坑码</th><th>卡号</th><th>转数</th><th>测定人</th><th>测定时刻</th><th>作废</th></tr>
          </thead>
          <tbody>
            ${list.map(
              (c) => html`<tr class=${c.voidedAt ? "voided" : ""}>
                <td>${c.pitCode}</td>
                <td>${c.cardNo}</td>
                <td>
                  ${c.rpm} 转/分
                  ${!c.voidedAt ? (c.qualified ? html`<span class="ok">合格</span>` : html`<span class="bad">出区间</span>`) : ""}
                </td>
                <td>${c.measurer}</td>
                <td>${fmtTime(c.measuredAt)}</td>
                <td>
                  ${c.voidedAt
                    ? html`已作废 · ${c.voidedBy} · ${fmtTime(c.voidedAt)}`
                    : this.user && this.user.role === "admin"
                      ? html`<button @click=${() => this.voidCard(c)}>作废</button>`
                      : ""}
                </td>
              </tr>`
            )}
          </tbody>
        </table>
        ${list.length ? "" : html`<p class="hint">没有转速卡</p>`}
      </section>
    </div>`;
  }
}

customElements.define("tan-yard", TanYard);
