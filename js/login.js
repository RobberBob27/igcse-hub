// Access codes: only people with a code you gave them can use the AI features.
// Codes are checked on the server (api/chat.js and api/quiz.py), not here.
import { getAccessCode, setAccessCode, toast } from "./core.js";

export function initLogin() {
  const btn = document.getElementById("loginBtn");
  const dlg = document.getElementById("loginDlg");
  const form = document.getElementById("loginForm");
  const input = document.getElementById("loginCode");
  const err = document.getElementById("loginErr");
  const cancel = document.getElementById("loginCancel");

  function refresh() {
    btn.textContent = getAccessCode() ? "Log out" : "Log in";
  }

  function open(reason) {
    err.textContent = reason || "";
    input.value = "";
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    input.focus();
  }

  btn.addEventListener("click", function () {
    if (getAccessCode()) { setAccessCode(""); toast("Logged out"); }
    else open();
  });
  cancel.addEventListener("click", function () { dlg.close(); });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const code = input.value.trim();
    if (!code) { err.textContent = "Enter your access code."; return; }
    err.textContent = "Checking…";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Access-Code": code },
        body: JSON.stringify({ check: true })
      });
      if (res.status === 401) { err.textContent = "That code isn't valid. Check it and try again."; return; }
      if (!res.ok) { err.textContent = "Couldn't check the code right now. Try again in a moment."; return; }
      setAccessCode(code);
      dlg.close();
      toast("Logged in. AI features are unlocked.");
    } catch (e2) {
      err.textContent = "Couldn't reach the server. Check your connection.";
    }
  });

  // Any AI request that comes back "login required" opens this box.
  document.addEventListener("need-login", function () {
    setAccessCode("");
    open("The AI tutor and AI quiz need an access code.");
  });
  document.addEventListener("access-change", refresh);
  refresh();
}
