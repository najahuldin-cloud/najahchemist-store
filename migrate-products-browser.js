// Paste this entire script into the browser console while logged in to the admin panel.
// It uses the already-authenticated Firebase session from the page.

(async () => {
  const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
  const db = window._db;
  if (!db) { console.error("window._db not found — make sure you're on the admin panel page"); return; }

  const PRODUCTS = window.PRODUCTS;
  if (!PRODUCTS || !PRODUCTS.length) { console.error("window.PRODUCTS is empty"); return; }

  console.log(`Migrating ${PRODUCTS.length} products...`);
  let ok = 0, fail = 0;

  for (const p of PRODUCTS) {
    try {
      await setDoc(doc(db, 'products', p.id), p);
      console.log(`✓ ${p.id}  ${p.name}`);
      ok++;
    } catch (e) {
      console.error(`✗ ${p.id}  ${p.name}:`, e.message);
      fail++;
    }
  }

  console.log(`\nMigration complete: ${ok} saved, ${fail} failed.`);
})();
