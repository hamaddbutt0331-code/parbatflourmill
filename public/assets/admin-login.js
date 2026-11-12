document.getElementById("f").addEventListener("submit", async e => {
  e.preventDefault(); const err = document.getElementById("e"); err.textContent = "";
  try {
    const r = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: document.getElementById("u").value, password: document.getElementById("p").value }) });
    const j = await r.json(); if (!r.ok) { err.textContent = j.error || "Sign in failed."; return; } location.href = "/admin";
  } catch (_) { err.textContent = "Could not reach the server. Try again."; }
});
