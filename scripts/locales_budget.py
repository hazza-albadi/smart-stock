# Texts of the budget cycle, funding states and emergency budget requests, English + Arabic. Runs after locales_space.py.
import json

W = {
"fund.FUNDED": ("Funded", "ممول"), "fund.PARTIAL": ("Partly funded", "ممول جزئياً"),
"fund.NEEDS_EXTRA": ("Emergency budget request", "طلب ميزانية طارئة"), "fund.DEFERRED": ("Deferred to next budget", "مؤجّل إلى الميزانية القادمة"),
"dc.emerg.title": ("Emergency: order {qty:n0} {unit:unit} of {item:item}", "طارئ: اطلب {qty:n0} {unit:unit} من {item:item}"),
"dc.emerg.after": ("If you approve: the order is placed now and {extra:omr} are added as emergency spend on top of the budget (order total {cost:omr}). It arrives around {date:date}.", "إن وافقت: يُقدَّم الطلب الآن وتُضاف {extra:omr} كإنفاق طارئ فوق الميزانية (إجمالي الطلب {cost:omr}). يصل نحو {date:date}."),
"dc.emerg.ignore": ("{item:item} runs out in about {hours:dur} (on {date:date}). Production that needs it stops until a delivery arrives.", "سينفد {item:item} خلال نحو {hours:dur} (في {date:date}). يتوقف الإنتاج الذي يحتاجه حتى تصل شحنة."),
"dc.emerg.ignore_nodate": ("{item:item} gets no money and keeps running down.", "لا يحصل {item:item} على مال ويواصل النقصان."),
"dc.emerg.approve": ("Approve emergency spend: {amount:omr}", "وافق على إنفاق طارئ: {amount:omr}"),
"dc.emerg.reduce": ("Reduce to {qty:n0} {unit:unit} ({cost:omr}): fits the emergency limit", "قلّل إلى {qty:n0} {unit:unit} ({cost:omr}): ضمن الحد الطارئ"),
"dc.emerg.limit_hint": ("The extra money is above the emergency limit of this period. Reduce the quantity or reject.", "المبلغ الإضافي أعلى من الحد الطارئ لهذه الفترة. قلّل الكمية أو ارفض."),
"dc.fund.small": ("Order only {qty:n0} {unit:unit} now ({cost:omr})", "اطلب {qty:n0} {unit:unit} فقط الآن ({cost:omr})"),
"dc.fund.alt": ("Alternative: {item:item} can replace it where the data allows. Check it before ordering.", "بديل: يمكن أن يحل {item:item} محله حيث تسمح البيانات. تحقق منه قبل الطلب."),
"dc.defer.after": ("Nothing is ordered now. The suggestion is checked again when the new budget starts on {date:date}; the order would cost {cost:omr}.", "لا يُطلب شيء الآن. يُراجع الاقتراح عند بدء الميزانية الجديدة في {date:date}؛ وتكلفة الطلب {cost:omr}."),
"dc.defer.wait": ("Wait for the next budget ({date:date})", "انتظر الميزانية القادمة ({date:date})"),
"repl.r.needs_extra": ("Critical item and only {left:omr} are free: the order needs {cost:omr}, so {extra:omr} more. It runs out around {date:date} (in about {hours:dur}).", "صنف حرج ولا يتوفر إلا {left:omr}: يحتاج الطلب {cost:omr}، أي {extra:omr} إضافية. سينفد نحو {date:date} (خلال نحو {hours:dur})."),
"repl.r.deferred_next": ("Not enough free budget ({left:omr} free, {cost:omr} needed). Deferred to the next budget on {date:date}.", "الميزانية الحرة غير كافية ({left:omr} متاحة والمطلوب {cost:omr}). مؤجّل إلى الميزانية القادمة في {date:date}."),
"alert.budget_low.title": ("Budget is low: {left:omr} left, renews on {date:date} ({days:n0} days)", "الميزانية منخفضة: بقي {left:omr}، وتتجدد في {date:date} (بعد {days:n0} يوماً)"),
"alert.budget_low.d1": ("{waiting:n0} suggestion(s) wait for money, {critical:n0} of them critical. The new budget of {amount:omr} starts on {date:date}; up to {room:omr} of emergency spend can still be approved.", "{waiting:n0} اقتراح بانتظار المال، منها {critical:n0} حرجة. تبدأ الميزانية الجديدة ({amount:omr}) في {date:date}؛ ويمكن اعتماد إنفاق طارئ حتى {room:omr}."),
"alert.budget_low.ignore": ("Orders that need more than the free money wait until {date:date}; critical ones need an emergency approval.", "الطلبات التي تحتاج أكثر من المتاح تنتظر حتى {date:date}؛ والحرجة تحتاج موافقة طارئة."),
"alert.unfunded.title": ("Critical item {item:item} cannot be funded: it runs out on {date:date}", "لا يمكن تمويل الصنف الحرج {item:item}: سينفد في {date:date}"),
"alert.unfunded.d1": ("The order costs {cost:omr} and {left:omr} are free ({extra:omr} missing). Emergency spend left this period: {room:omr}. Decide in “Needs your decision”.", "تكلفة الطلب {cost:omr} والمتاح {left:omr} (ينقص {extra:omr}). المتبقي من الإنفاق الطارئ لهذه الفترة: {room:omr}. قرّر في «ما يحتاج قرارك»."),
"alert.unfunded.ignore": ("{item:item} runs out in about {hours:dur} (on {date:date}) and the production that needs it stops.", "سينفد {item:item} خلال نحو {hours:dur} (في {date:date}) ويتوقف الإنتاج الذي يحتاجه."),
"alert.prop.BUDGET_LOW": ("Approve the critical orders as emergency spend, or wait for the renewal.", "اعتمد الطلبات الحرجة كإنفاق طارئ أو انتظر التجديد."),
"alert.prop.UNFUNDED_CRITICAL": ("Approve the emergency spend, reduce the quantity, or accept the stock-out.", "اعتمد الإنفاق الطارئ أو قلّل الكمية أو اقبل النفاد."),
"ev.budget_renewed": ("New budget period {start:date} to {end:date}: {total:omr} (carried over {rollover:omr}).", "فترة ميزانية جديدة من {start:date} إلى {end:date}: {total:omr} (مرحّل {rollover:omr})."),
"ev.budget_topup": ("Emergency spend approved: {amount:omr} for {item:item} (order {po}).", "اعتُمد إنفاق طارئ: {amount:omr} لـ {item:item} (الطلب {po})."),
"impact.e.emergency_spend": ("→ {amount:omr} of emergency spend were added to the budget for this order; budget left now {free:omr}", "← أُضيفت {amount:omr} كإنفاق طارئ إلى الميزانية لهذا الطلب؛ المتبقي الآن {free:omr}"),
"budget.err.over_limit": ("Not allowed: this order needs {extra:omr} more than the free budget, but only {room:omr} of emergency spend are left in this period. At most {max:n0} {unit:unit} of {item:item} fit now. Reduce the quantity or wait for the new budget on {date:date}.", "غير مسموح: يحتاج هذا الطلب {extra:omr} أكثر من الميزانية المتاحة، ولم يبقَ من الإنفاق الطارئ في هذه الفترة إلا {room:omr}. أقصى كمية الآن {max:n0} {unit:unit} من {item:item}. قلّل الكمية أو انتظر الميزانية الجديدة في {date:date}."),
"repl.err.no_room": ("There is no room for {item:item} when this order would arrive. Wait until stock is used up or reduce other orders.", "لا توجد مساحة لـ {item:item} عند وصول هذا الطلب. انتظر حتى يُستهلك المخزون أو قلّل طلبات أخرى."),
"alert.no_room.title": ("Cannot order {item:item}: no room in {zone:zone} when it would arrive", "لا يمكن طلب {item:item}: لا توجد مساحة في {zone:zone} عند وصوله"),
"alert.no_room.d1": ("The order needs room for {qty:n0} {unit:unit}, but {zone:zone} and the overflow area ({overflow:zone}) are full. Room comes back when stock is used up, moved, or when a rental ends.", "يحتاج الطلب مساحة لـ {qty:n0} {unit:unit} لكن {zone:zone} ومنطقة الفائض ({overflow:zone}) ممتلئتان. تعود المساحة عند استهلاك المخزون أو نقله أو انتهاء إيجار."),
"alert.no_room.ignore": ("{item:item} stays at zero until room is free.", "يبقى {item:item} عند الصفر حتى تتوفر مساحة."),
"alert.prop.NO_ROOM": ("Use up or move other stock, or end a rental, to free room.", "استهلك مخزوناً آخر أو انقله، أو أنهِ إيجاراً لتحرير مساحة."),
"kpi.budget_renews": ("renews", "تتجدد"), "kpi.emergency": ("Emergency spend:", "إنفاق طارئ:"),
"plan.renews": ("renews on", "تتجدد في"), "plan.rollover": ("Carried over", "مرحّل"), "plan.emergency": ("Emergency spend (limit)", "إنفاق طارئ (الحد)"),
"ex.in.rollover": ("Carried over from the last period", "مرحّل من الفترة السابقة"), "ex.in.topup": ("Approved emergency spend", "إنفاق طارئ معتمد"),
}

if __name__ == "__main__":
    for lang, idx in (("en", 0), ("ar", 1)):
        path = f"locales/{lang}.json"
        cur = json.load(open(path, encoding="utf8"))
        cur.update({k: v[idx] for k, v in W.items()})
        json.dump(cur, open(path, "w", encoding="utf8"), ensure_ascii=False, indent=1)
    print(len(W), "budget keys")
