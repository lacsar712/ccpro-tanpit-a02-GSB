import { LitElement, css, html } from "lit";

const TOKEN_KEY = "tanpit_token";
const LABELS = { fill: "注液", tanning: "鞣制中", drained: "已放液" };
const ROLE_LABELS = { admin: "值班长", worker: "操作工" };

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "请求失败");
  return data;
}

class TanYard extends LitElement {
  static properties = {
    ready: { type: Boolean },
    board: { type: Object },
    picked: { type: Object },
    ph: { type: String },
    err: { type: String },
    username: { type: String },
    password: { type: String },
    user: { type: Object },
    view: { type: String },
    cards: { type: Array },
    cardPitFilter: { type: String },
    formPitId: { type: Number },
    formCardNo: { type: String },
    formRpm: { type: String },
  };

  static styles = css`
    :host { display: block; font-family: "KaiTi", serif; color: #2b2118; }
    .wrap { max-width: 880px; margin: 0 auto; padding: 28px 16px 50px; }
    .topbar { display: flex; align-items: center; gap: 8px; border-bottom: 2px solid #d8c9b0; padding-bottom: 10px; margin-bottom: 16px; }
    .topbar .brand { font-weight: bold; margin-right: 12px; }
    .tab { border: 1px solid #b7a685; background: #f4ecdd; border-radius: 6px; cursor: pointer; }
    .tab.on { background: #8a5a2b; color: #fff; border-color: #8a5a2b; }
    .who { margin-left: auto; color: #6b5a48; font-size: 0.92em; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .pit { min-height: 110px; border-radius: 8px; color: #fff; cursor: pointer; border: 0; }
    .fill { background: #6d8f9e; }
    .tanning { background: #8a5a2b; }
    .drained { background: #5f6f4a; }
    .err { color: #9b1c1c; }
    .hint { color: #6b5a48; font-size: 0.92em; }
    label { display: block; margin: 8px 0; }
    input, button, select { font: inherit; padding: 8px 10px; margin: 4px 6px 4px 0; }
    .newcard { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 2px 16px; padding: 10px 12px; background: #f7f1e4; border-radius: 8px; }
    .newcard label { margin: 4px 0; }
    .scale input[type="range"] { width: 240px; vertical-align: middle; }
    table { border-collapse: collapse; width: 100%; margin-top: 14px; }
    th, td { border: 1px solid #d8c9b0; padding: 6px 8px; text-align: left; }
    tr.void td { color: #9a8b78; }
  `;

  constructor() {
    super();
    this.ready = Boolean(localStorage.getItem(TOKEN_KEY));
    this.board = null;
    this.picked = null;
    this.ph = "4.2";
    this.err = "";
    this.username = "admin";
    this.password = "123456";
    this.user = null;
    this.view = "board";
    this.cards = null;
    this.cardPitFilter = "";
    this.formPitId = null;
    this.formCardNo = "1";
    this.formRpm = "11";
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.ready) {
      this.loadMe();
      this.refresh();
    }
  }

  async loadMe() {
    try {
      this.user = await api("/api/auth/me");
    } catch (e) {
      /* 忽略，角色相关按钮只是不显示 */
    }
  }

  async refresh() {
    try {
      this.board = await api("/api/board");
      if (this.picked) {
        this.picked = this.board.pits.find((p) => p.id === this.picked.id) || this.board.pits[0];
      }
    } catch (e) {
      this.err = e.message;
    }
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

  async openCards() {
    this.view = "cards";
    this.err = "";
    await this.loadCards();
  }

  async loadCards() {
    try {
      const data = await api("/api/cards");
      this.cards = data.cards;
      if (this.formPitId == null && this.board?.pits?.length) this.formPitId = this.board.pits[0].id;
      if (this.formPitId != null) this.formCardNo = this.nextCardNo(this.formPitId);
    } catch (e) {
      this.err = e.message;
    }
  }

  nextCardNo(pitId) {
    const actives = (this.cards || []).filter((c) => c.pitId === pitId && !c.voidedAt);
    return String(actives.reduce((m, c) => Math.max(m, c.cardNo), 0) + 1);
  }

  onFormPit(e) {
    this.formPitId = Number(e.target.value);
    this.formCardNo = this.nextCardNo(this.formPitId);
  }

  async createCard(e) {
    e.preventDefault();
    this.err = "";
    try {
      await api("/api/cards", {
        method: "POST",
        body: JSON.stringify({
          pit_id: Number(this.formPitId),
          card_no: Number(this.formCardNo),
          rpm: Number(this.formRpm),
        }),
      });
      await this.loadCards();
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
      await this.loadCards().catch(() => {});
    }
  }

  async voidCard(card) {
    this.err = "";
    try {
      await api(`/api/cards/${card.id}/void`, { method: "POST" });
      await this.loadCards();
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  shownCards() {
    const all = this.cards || [];
    if (!this.cardPitFilter) return all;
    return all.filter((c) => String(c.pitId) === this.cardPitFilter);
  }

  fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString("zh-CN", { hour12: false });
  }

  renderTopbar() {
    return html`<nav class="topbar">
      <span class="brand">${this.board.yard}</span>
      <button class="tab ${this.view === "board" ? "on" : ""}" @click=${() => (this.view = "board")}>坑位场地图</button>
      <button class="tab ${this.view === "cards" ? "on" : ""}" @click=${this.openCards}>转速卡</button>
      <span class="who">${this.user ? `${this.user.username} · ${ROLE_LABELS[this.user.role] || this.user.role}` : ""}</span>
    </nav>`;
  }

  renderBoard() {
    return html`
      <p>${this.board.village} · 点坑登记浸液酸碱度；放液须最近读数 3.5～5.0；注液改鞣制中须在用转速卡 8～14 转/分</p>
      <div class="grid">
        ${this.board.pits.map(
          (p) => html`<button class="pit ${p.status}" @click=${() => (this.picked = p)}>
            <strong>${p.code}</strong><br />${LABELS[p.status]}
          </button>`
        )}
      </div>
      ${this.picked
        ? html`<section>
            <h3>${this.picked.code} · ${LABELS[this.picked.status]}</h3>
            <p>最近酸碱度：${this.picked.latestPh ?? "无"} · ${this.picked.sampleCount} 次</p>
            <p>最近在用转速：${this.picked.latestRpm != null ? html`${this.picked.latestRpm} 转/分（${this.picked.latestCardNo} 号卡）` : "无"}</p>
            <input .value=${this.ph} @input=${(e) => (this.ph = e.target.value)} />
            <button @click=${this.writePh}>登记酸碱度</button>
            <div>
              <button @click=${() => this.setStatus("fill")}>注液</button>
              <button @click=${() => this.setStatus("tanning")}>鞣制中</button>
              <button @click=${() => this.setStatus("drained")}>已放液</button>
            </div>
          </section>`
        : ""}
    `;
  }

  renderCards() {
    const rows = this.shownCards();
    return html`<section>
      <h3>转速卡</h3>
      <label>按坑筛选
        <select .value=${this.cardPitFilter} @change=${(e) => (this.cardPitFilter = e.target.value)}>
          <option value="">全部</option>
          ${this.board.pits.map((p) => html`<option value=${p.id}>${p.code}</option>`)}
        </select>
      </label>
      <form class="newcard" @submit=${this.createCard} autocomplete="off">
        <label>坑
          <select .value=${String(this.formPitId ?? "")} @change=${this.onFormPit}>
            ${this.board.pits.map((p) => html`<option value=${p.id}>${p.code}</option>`)}
          </select>
        </label>
        <label>卡号
          <input type="number" min="1" step="1" .value=${this.formCardNo} @input=${(e) => (this.formCardNo = e.target.value)} />
        </label>
        <label class="scale">每分钟转数
          <input type="range" min="1" max="20" step="1" list="rpm-scale" .value=${this.formRpm} @input=${(e) => (this.formRpm = e.target.value)} />
          <datalist id="rpm-scale">
            ${[...Array(20)].map((_, i) => html`<option value=${i + 1}></option>`)}
          </datalist>
          <strong>${this.formRpm} 转/分</strong>
        </label>
        <button>建卡</button>
        <span class="hint">合格区间 8～14 转/分</span>
      </form>
      ${rows.length
        ? html`<table>
            <thead>
              <tr><th>坑码</th><th>卡号</th><th>每分钟转数</th><th>测定人</th><th>测定时刻</th><th>作废</th></tr>
            </thead>
            <tbody>
              ${rows.map(
                (c) => html`<tr class=${c.voidedAt ? "void" : ""}>
                  <td>${c.pitCode}</td>
                  <td>${c.cardNo}</td>
                  <td>${c.rpm} 转/分</td>
                  <td>${c.measurer}</td>
                  <td>${this.fmtTime(c.measuredAt)}</td>
                  <td>${c.voidedAt
                    ? html`已作废 · ${c.voidedBy}`
                    : this.user && this.user.role === "admin"
                      ? html`<button @click=${() => this.voidCard(c)}>作废</button>`
                      : ""}</td>
                </tr>`
              )}
            </tbody>
          </table>`
        : html`<p class="hint">暂无转速卡</p>`}
    </section>`;
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
          <p class="hint">已预填 admin / 123456，另有 worker / 123456</p>
          <button>登录</button>
        </form>
        ${this.err ? html`<p class="err">${this.err}</p>` : ""}
      </div>`;
    }
    if (!this.board) return html`<div class="wrap">${this.err || "装载坑位…"}</div>`;
    return html`<div class="wrap">
      ${this.renderTopbar()}
      ${this.view === "cards" ? this.renderCards() : this.renderBoard()}
      ${this.err ? html`<p class="err">${this.err}</p>` : ""}
    </div>`;
  }
}

customElements.define("tan-yard", TanYard);
