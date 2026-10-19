// Shared state, theme, storage and small helpers.
import { subjects } from "./data.js";

const root = document.documentElement.style;

export const state = {
  current: null,          // currently selected subject row (array from data.js) or null
  listeners: []
};

export function onSubjectChange(fn) { state.listeners.push(fn); }

export function setSubject(s, opts) {
  state.current = s || null;
  applyTheme(state.current);
  if (!(opts && opts.silent)) state.listeners.forEach(function (fn) { fn(state.current); });
}

export function applyTheme(s) {
  const v = s
    ? { h: s[2], s: s[3], a: s[4], l: s[5], is: s[3] === "0%" ? "0%" : "40%" }
    : { h: 150, s: "18%", a: "80%", l: "52%", is: "40%" };
  root.setProperty("--h", v.h);
  root.setProperty("--s", v.s);
  root.setProperty("--a", v.a);
  root.setProperty("--l", v.l);
  root.setProperty("--is", v.is);
}

export function setDim(on) {
  root.setProperty("--bgl", on ? "5%" : "8%");
  root.setProperty("--sl", on ? "8%" : "12%");
  root.setProperty("--ll", on ? "15%" : "21%");
}

// localStorage can be missing or throw (private mode, blocked storage) — never let that break the page.
export const store = {
  get(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  },
  remove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }
};

export function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

let toastTimer;
export function toast(msg, ms) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg || "Placeholder: add your file or link here.";
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove("on"); }, ms || 1800);
}

export function fillSubjectSelect(select, includeGeneral) {
  select.innerHTML = "";
  if (includeGeneral) {
    const o = document.createElement("option");
    o.value = ""; o.textContent = "General / any subject";
    select.appendChild(o);
  }
  subjects.forEach(function (s) {
    const o = document.createElement("option");
    o.value = s[0];
    o.textContent = (s[0] === "Mathematics" ? "Mathematics A" : s[0]) + " (" + s[1] + ")";
    select.appendChild(o);
  });
}

// Wire a .seg button group; returns a getter/setter.
export function segmented(el, onChange) {
  function set(v) {
    el.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === String(v))); });
  }
  function get() {
    const b = el.querySelector("button[aria-pressed='true']");
    return b ? b.dataset.v : null;
  }
  el.addEventListener("click", function (e) {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    set(b.dataset.v);
    if (onChange) onChange(b.dataset.v);
  });
  return { get: get, set: set };
}
