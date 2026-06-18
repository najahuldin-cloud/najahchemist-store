// Phase 4.3 — Order Lifecycle Correction validation harness.
// Extracts the REAL lifecycle helpers from jarvis.html and exercises the 9 required
// scenarios using the exact predicates the dashboard now uses. Read-only; no deploy.
//
// Run: node scripts/validate-phase4.3-lifecycle.js
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "jarvis.html"), "utf8");

// Brace-matched extraction of a function/const's source from the file.
function grab(decl){
  const start = html.indexOf(decl);
  if(start < 0) throw new Error("not found: " + decl);
  let i = html.indexOf("{", start), depth = 0;
  for(; i < html.length; i++){
    if(html[i] === "{") depth++;
    else if(html[i] === "}"){ depth--; if(depth === 0){ return html.slice(start, i+1); } }
  }
  throw new Error("unbalanced: " + decl);
}
function grabLine(decl){
  const start = html.indexOf(decl);
  if(start < 0) throw new Error("not found: " + decl);
  return html.slice(start, html.indexOf("\n", start));
}

// Pull the real source: ORDER_CLOSED, orderLifecycle, isClosed, isPaid, isOpen, orderTotal.
// Eval together (var, so the binding leaks into this scope for the function declarations).
eval([
  grabLine("const ORDER_CLOSED").replace("const ", "var "),
  grab("function orderLifecycle"),
  grab("function isClosed"),
  grab("function isPaid"),
  grab("function isOpen"),
  grab("function orderTotal"),
].join("\n"));

// Predicates exactly as the dashboard applies them (Phase 4.3):
const unpaidFilter   = o => isOpen(o);                 // computeContext.unpaidOrders / Money Left
const reorderFilter  = list => list.filter(isPaid);    // BUCKET 2 reorder engine
const revenueFilter  = o => isPaid(o);                 // revenueThisMonth / todayRev
const conversionSet  = orders => new Set(orders.filter(isPaid).map(o => (o.email||"").toLowerCase()).filter(Boolean));
const reminderFilter = o => isOpen(o);                 // payment reminder audience (open only)

let pass=0, fail=0;
const chk = (n, c) => { console.log((c?"PASS":"FAIL") + " — " + n); c?pass++:fail++; };

// Sample orders covering every lifecycle state and both fields.
const O = {
  pending:     { id:"P", total:10000, status:"Pending",  paymentStatus:"Unpaid",  email:"a@x.com" },
  awaiting:    { id:"AW",total:20000, status:"Pending",  paymentStatus:"Awaiting Payment", email:"a@x.com" },
  paid:        { id:"PD",total:30000, status:"Complete", paymentStatus:"Paid",    email:"b@x.com" },
  cancStatus:  { id:"C1",total:40000, status:"Cancelled",paymentStatus:"Unpaid",  email:"c@x.com" },
  cancPay:     { id:"C2",total:50000, status:"Pending",  paymentStatus:"Cancelled",email:"c@x.com" },
  abandoned:   { id:"AB",total:60000, status:"Pending",  paymentStatus:"Abandoned",email:"d@x.com" },
  refunded:    { id:"RF",total:70000, status:"Complete", paymentStatus:"Refunded",email:"e@x.com" },
  paidThenCanc:{ id:"PC",total:80000, status:"Cancelled",paymentStatus:"Paid",    email:"f@x.com" }, // closed wins
};

// Lifecycle classification sanity
chk("classify pending=open",     orderLifecycle(O.pending)==="open");
chk("classify awaiting=open",    orderLifecycle(O.awaiting)==="open");
chk("classify paid=success",     orderLifecycle(O.paid)==="success");
chk("classify cancel(status)=closed",  orderLifecycle(O.cancStatus)==="closed");
chk("classify cancel(payment)=closed", orderLifecycle(O.cancPay)==="closed");
chk("classify abandoned=closed", orderLifecycle(O.abandoned)==="closed");
chk("classify refunded=closed",  orderLifecycle(O.refunded)==="closed");
chk("classify paid+cancelled=closed (closed wins)", orderLifecycle(O.paidThenCanc)==="closed");

// Scenario 1: Cancelled order excluded from unpaid totals
{
  const orders=[O.pending, O.cancStatus, O.cancPay];
  const unpaid=orders.filter(unpaidFilter);
  const total=unpaid.reduce((s,o)=>s+orderTotal(o),0);
  chk("S1 cancelled excluded from unpaid (only pending counts, total=10000)", total===10000 && unpaid.length===1);
}
// Scenario 2: Abandoned order excluded from opportunities (unpaid bucket uses !closed && !paid = open)
{
  const orders=[O.pending, O.abandoned];
  const opp=orders.filter(o=>!isClosed(o) && !isPaid(o));
  chk("S2 abandoned excluded from opportunity bucket", opp.length===1 && opp[0].id==="P");
}
// Scenario 3: Refunded order excluded from reorder engine
{
  const list=[O.refunded];
  chk("S3 refunded excluded from reorder (no paid order)", reorderFilter(list).length===0);
}
// Scenario 4: Paid order still contributes to revenue
{
  const orders=[O.paid, O.refunded, O.cancStatus, O.pending];
  const rev=orders.filter(revenueFilter).reduce((s,o)=>s+orderTotal(o),0);
  chk("S4 paid contributes to revenue (=30000, closed/open excluded)", rev===30000);
}
// Scenario 5: Paid order still contributes to reorder engine
{
  const list=[O.paid];
  chk("S5 paid enters reorder engine", reorderFilter(list).length===1 && reorderFilter(list)[0].id==="PD");
}
// Scenario 6: Customer with Cancelled Order A + Paid Order B uses Order B only
{
  const A={ id:"A",total:99999, status:"Cancelled", paymentStatus:"Unpaid", email:"z@x.com", d:"2026-06-10" };
  const B={ id:"B",total:25000, status:"Complete",  paymentStatus:"Paid",   email:"z@x.com", d:"2026-06-15" };
  const list=[A,B];
  const dated=reorderFilter(list);                 // success-only
  const lastPaid=dated[dated.length-1];
  chk("S6 reorder uses Order B (paid) only", dated.length===1 && lastPaid.id==="B" && orderTotal(lastPaid)===25000);
}
// Scenario 7: Conversion rate ignores closed orders (and open/unpaid)
{
  const orders=[O.paid, O.cancStatus, O.cancPay, O.abandoned, O.refunded, O.pending];
  const set=conversionSet(orders);
  chk("S7 conversion counts only paid emails (b@x.com)", set.size===1 && set.has("b@x.com"));
}
// Scenario 8: Payment reminder audience excludes closed orders
{
  const orders=[O.pending, O.awaiting, O.cancStatus, O.cancPay, O.abandoned, O.refunded, O.paid];
  const audience=orders.filter(reminderFilter);
  chk("S8 reminder audience = open only (pending+awaiting=2)", audience.length===2 && audience.every(isOpen));
}
// Scenario 9: Money Left On Table excludes closed orders
{
  const orders=[O.pending, O.cancStatus, O.abandoned, O.refunded, O.paidThenCanc];
  const moneyLeft=orders.filter(unpaidFilter).reduce((s,o)=>s+orderTotal(o),0);
  chk("S9 money-left excludes all closed (=10000 from pending only)", moneyLeft===10000);
}

// Scenario 10: Product intelligence eligibility = isPaid only (refunded-but-Complete excluded)
{
  const refundedButComplete = { id:"RC", total:90000, status:"Complete", paymentStatus:"Refunded", email:"g@x.com" };
  const completeUnpaid      = { id:"CU", total:15000, status:"Complete", paymentStatus:"Unpaid",   email:"h@x.com" };
  const orders=[O.paid, refundedButComplete, completeUnpaid];
  const eligible=orders.filter(o=>isPaid(o));   // product-frequency eligibility
  chk("S10 product intel eligibility = paid only (refunded/unpaid 'Complete' excluded)",
      eligible.length===1 && eligible[0].id==="PD");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
