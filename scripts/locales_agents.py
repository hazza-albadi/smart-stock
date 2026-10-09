# Texts of the agent stages (READ -> REASON -> ACT -> VERIFY), the registry cards, the daily summary and the drafts, English + Arabic. Runs last (after locales_offers.py).
import json

W = {
# ---- the five agents (names and one-sentence roles; ids are the registry ids)
"agent.forecast": ("Forecast", "التوقع"),
"agent.replenishment": ("Replenishment", "التزويد"),
"agent.space-optimization": ("Space Optimization", "تحسين المساحات"),
"agent.alerts": ("Alerts", "التنبيهات"),
"agent.space-forecast": ("Space Forecast", "توقع المساحات"),
"agentdef.forecast.role": ("Turns the movement history into weekly usage, a seasonal forecast and flags for sudden demand jumps.", "يحوّل سجل الحركة إلى استهلاك أسبوعي وتوقع موسمي وتنبيه لقفزات الطلب المفاجئة."),
"agentdef.replenishment.role": ("Decides which items need an order, how much and in what order, within the free budget and the room of each zone.", "يقرر الأصناف التي تحتاج طلباً وكميته وترتيبه ضمن الميزانية المتاحة ومساحة كل منطقة."),
"agentdef.space-optimization.role": ("Works out, zone by zone, how much area the stock uses, how much is held back and how much can be rented out.", "يحسب لكل منطقة المساحة التي يشغلها المخزون والمحجوزة والقابلة للتأجير."),
"agentdef.alerts.role": ("Raises a warning for every risk: what is wrong, why, and what happens if it is ignored. Drafts supplier messages for the serious ones.", "ينبّه إلى كل خطر: ما المشكلة ولماذا وماذا يحدث إن تُجوهل، ويصيغ رسائل للموردين في الحالات الخطيرة."),
"agentdef.space-forecast.role": ("Looks ahead for space the company will not need, keeps what it must keep, and flags conflicts between rentals and purchasing.", "يتطلع إلى المساحات التي لن تحتاجها الشركة ويُبقي ما يلزم ويبرز التعارض بين التأجير والمشتريات."),
"stage.READ": ("Read", "قراءة"), "stage.REASON": ("Reason", "استنتاج"), "stage.ACT": ("Act", "تنفيذ"), "stage.VERIFY": ("Verify", "تحقق"),
# ---- stage sentences (numbers are values)
"step.forecast.read": ("Read {items:n0} items and {moves:n0} issue records from the movement history to build a {weeks:n0}-week forecast.", "قرأتُ {items:n0} صنفاً و{moves:n0} سجل صرف من سجل الحركة لبناء توقع لـ {weeks:n0} أسابيع."),
"step.forecast.reason": ("Worked out weekly usage and the seasonal forecast. Sudden demand jumps: {anomalies:n0}. Items that may run out before a delivery can arrive: {atRisk:n0}.", "حسبتُ الاستهلاك الأسبوعي والتوقع الموسمي. قفزات طلب مفاجئة: {anomalies:n0}. أصناف قد تنفد قبل وصول توريد: {atRisk:n0}."),
"step.forecast.act": ("Wrote {n:n0} forecast rows.", "كتبتُ {n:n0} صف توقع."),
"step.replenishment.read": ("Read {items:n0} items, {pos:n0} open orders and {free:omr} of free budget.", "قرأتُ {items:n0} صنفاً و{pos:n0} طلبات مفتوحة و{free:omr} ميزانية متاحة."),
"step.replenishment.reason": ("{n:n0} item(s) need an order: {funded:n0} suggested, {deferred:n0} waiting. {skipped:n0} item(s) have too much stock.", "{n:n0} صنف يحتاج طلباً: {funded:n0} مقترح و{deferred:n0} بالانتظار. {skipped:n0} صنف مخزونه زائد."),
"step.replenishment.act": ("Wrote {plan:n0} plan rows and {drafts:n0} order draft(s) waiting for you; newly funded: {cost:omr}.", "كتبتُ {plan:n0} صف خطة و{drafts:n0} مسودة طلب بانتظارك؛ الممول حديثاً: {cost:omr}."),
"step.space-optimization.read": ("Read {zones:n0} zones, {leases:n0} rentals that hold area and {lots:n0} stock lots.", "قرأتُ {zones:n0} مناطق و{leases:n0} إيجارات تحجز مساحة و{lots:n0} دفعات مخزون."),
"step.space-optimization.reason": ("Rentable now {rentable:m2}; {allocated:m2} held by active rentals; over capacity {over:m2}.", "القابل للتأجير الآن {rentable:m2}؛ {allocated:m2} محجوزة بإيجارات فعلية؛ تجاوز السعة {over:m2}."),
"step.space-optimization.act": ("Wrote the figures of {n:n0} zones.", "كتبتُ أرقام {n:n0} مناطق."),
"step.alerts.read": ("Read {items:n0} items, {pos:n0} open orders and the figures of {zones:n0} zones.", "قرأتُ {items:n0} صنفاً و{pos:n0} طلبات مفتوحة وأرقام {zones:n0} مناطق."),
"step.alerts.reason": ("Found {total:n0} risk(s): {critical:n0} critical, {high:n0} high.", "وجدتُ {total:n0} خطراً: {critical:n0} حرج و{high:n0} مرتفع."),
"step.alerts.act": ("{active:n0} alert(s) active ({fresh:n0} new); {drafts:n0} supplier message(s) drafted for your approval.", "{active:n0} تنبيه نشط ({fresh:n0} جديد)؛ {drafts:n0} رسالة مورد صيغت لاعتمادك."),
"step.space-forecast.read": ("Read {zones:n0} rentable zone(s), {listings:n0} open listing(s) and {leases:n0} rental(s).", "قرأتُ {zones:n0} مناطق قابلة للتأجير و{listings:n0} إعلانات مفتوحة و{leases:n0} إيجارات."),
"step.space-forecast.reason": ("Looked {days:n0} days ahead: {windows:n0} free window(s) worth {area:m2}; {held:n0} kept empty.", "نظرتُ {days:n0} يوماً إلى الأمام: {windows:n0} نافذة فارغة بمساحة {area:m2}؛ {held:n0} مُبقاة فارغة."),
"step.space-forecast.act": ("Wrote {rows:n0} forecast rows; {conflicts:n0} conflict alert(s) with purchasing.", "كتبتُ {rows:n0} صف توقع؛ {conflicts:n0} تنبيه تعارض مع المشتريات."),
"step.verify.ok": ("Self-check passed ({n:n0} check(s)).", "نجح الفحص الذاتي ({n:n0} فحص)."),
"step.verify.fail": ("Self-check failed: {n:n0} of {total:n0} check(s). First: {first:msg} ({detail}).", "فشل الفحص الذاتي: {n:n0} من {total:n0}. الأول: {first:msg} ({detail})."),
"step.unavailable": ("Not available.", "غير متاح."),
"vchk.forecast_values_valid": ("No negative or invalid value in the forecast", "لا قيم سالبة أو غير صالحة في التوقع"),
"vchk.forecast_covers_every_item": ("Every item has a forecast", "لكل صنف توقع"),
"vchk.drafts_valid_and_within_budget_and_room": ("Order drafts: quantity above zero and a multiple of the step, within budget and room", "مسودات الطلب: كمية أكبر من صفر ومضاعف للخطوة، ضمن الميزانية والمساحة"),
"vchk.zones_within_capacity_and_rentable_not_negative": ("No zone above its capacity and no negative rentable area", "لا منطقة فوق سعتها ولا مساحة قابلة للتأجير سالبة"),
"vchk.alerts_complete_and_unique": ("Every alert has a known kind, severity and a what / why / if-ignored message; none twice", "لكل تنبيه نوع ودرجة معروفان ورسالة (ما/لماذا/إن تُجوهل)؛ بلا تكرار"),
"vchk.listed_area_within_free_window": ("Listed area never above its free window", "المساحة المعروضة لا تتجاوز نافذتها الفارغة"),
"vchk.leased_plus_company_need_within_capacity": ("Leased area plus the company's own need within the zone capacity", "المؤجَّر مع حاجة الشركة ضمن سعة المنطقة"),
"vchk.verify_error": ("The check itself could not run", "تعذّر تشغيل الفحص نفسه"),
"vchk.forced_for_test": ("Test check (forced failure)", "فحص تجريبي (فشل مفروض)"),
"ev.agent_warn": ("Warning: {agent:msg} failed its own check twice: {what:msg} ({detail}). The simulation continues; please look at the Agent panel.", "تحذير: فشل «{agent:msg}» في فحصه الذاتي مرتين: {what:msg} ({detail}). تستمر المحاكاة؛ يرجى مراجعة لوحة الوكلاء."),
# ---- Agent panel
"agents.attempt": ("Attempt", "المحاولة"), "agents.rerun": ("Run again after a failed check", "أُعيد التشغيل بعد فشل الفحص"),
"agents.check_failed": ("Check failed", "فشل الفحص"), "agents.check_ok": ("Checked", "تم التحقق"),
"agents.no_steps": ("Older runs: one line only.", "تشغيلات أقدم: سطر واحد فقط."),
"agents.warning": ("An agent failed its own check twice. The simulation continues; please review the steps marked ✕.", "فشل وكيل في فحصه الذاتي مرتين. تستمر المحاكاة؛ يرجى مراجعة الخطوات المعلّمة ✕."),
# ---- Help: How the agents work
"help.agents": ("How the agents work", "كيف يعمل الوكلاء"),
"agents.flow.title": ("The flow", "المسار"),
"agents.flow.text": ("Five agents run one after the other. They never call each other: each reads the shared database, writes its result there, and the coordinator hands over to the next one. Every agent logs four stages: what it READ, what it decided (REASON), what it wrote (ACT), and the result of its own check (VERIFY). If a check fails the agent runs once more, and if it still fails you see a warning.", "يعمل خمسة وكلاء بالتتابع. لا ينادي أحدهم الآخر: كلٌّ يقرأ قاعدة البيانات المشتركة ويكتب نتيجته فيها ثم يسلّم المنسّق إلى التالي. يسجّل كل وكيل أربع مراحل: ما قرأه (قراءة) وما قرره (استنتاج) وما كتبه (تنفيذ) ونتيجة فحصه الذاتي (تحقق). إن فشل الفحص أُعيد تشغيل الوكيل مرة، وإن فشل ثانية ظهر تحذير."),
"agents.flow.db": ("Shared database", "قاعدة البيانات المشتركة"), "agents.flow.coordinator": ("Coordinator", "المنسّق"),
"agents.flow.human": ("You approve", "أنت تعتمد"),
"agents.flow.human_text": ("The agents only propose. Nothing is ordered, rented or sent until a person approves it. Every approval is stored with its simulated time and can be followed in “After your decisions”.", "الوكلاء يقترحون فقط. لا يُطلب شيء ولا يُؤجَّر ولا يُرسل حتى يعتمده إنسان. يُحفظ كل اعتماد بوقته المحاكى ويمكن تتبعه في «بعد قراراتك»."),
"agents.card.reads": ("Reads", "يقرأ"), "agents.card.writes": ("Writes", "يكتب"), "agents.card.runs": ("Runs", "يعمل"), "agents.card.last": ("Last run", "آخر تشغيل"),
"agents.card.verify": ("Self-check", "الفحص الذاتي"), "agents.card.checks": ("Checks", "الفحوص"), "agents.card.never": ("not run yet", "لم يعمل بعد"),
"agents.card.every_hour": ("every hour", "كل ساعة"), "agents.card.at_hours": ("at hours", "عند الساعات"), "agents.card.after_decision": ("and after every decision", "وبعد كل قرار"),
"agents.card.stage": ("Stage", "المرحلة"), "agents.card.hands": ("Hands over to", "يسلّم إلى"), "agents.card.human": ("a person decides", "يقرر إنسان"),
# ---- daily summary
"sum.title": ("Daily summary", "الملخص اليومي"), "sum.top": ("Top risks", "أهم المخاطر"),
"sum.as_of": ("As of", "حتى"), "sum.empty": ("The summary appears after the 08:00 run, after “Run analysis” and at the start.", "يظهر الملخص بعد تشغيل الساعة 08:00 وبعد «تشغيل التحليل» وعند البداية."),
"sum.risks": ("{n:n0} risk(s) are critical or high.", "{n:n0} خطر حرج أو مرتفع."), "sum.risks_none": ("No critical or high risks.", "لا مخاطر حرجة أو مرتفعة."),
"sum.decisions": ("{n:n0} decision(s) waiting for you; the oldest has waited {age:dur}.", "{n:n0} قرار بانتظارك؛ أقدمها ينتظر {age:dur}."), "sum.decisions_none": ("No decisions waiting.", "لا قرارات بالانتظار."),
"sum.budget": ("Budget: {used:omr} used, {free:omr} free of {total:omr}.", "الميزانية: استُخدم {used:omr} ويتبقى {free:omr} من {total:omr}."),
"sum.space": ("Space: {listable:m2} can be listed, {leased:m2} leased, rental income so far {income:omr}.", "المساحات: {listable:m2} قابلة للإعلان و{leased:m2} مؤجَّرة، ودخل الإيجار حتى الآن {income:omr}."),
"sum.offers": ("{n:n0} offer(s) from companies are waiting for your answer.", "{n:n0} عرض من الشركات بانتظار ردك."), "sum.offers_none": ("No offers waiting.", "لا عروض بالانتظار."),
# ---- drafts
"tab.drafts": ("Drafts", "المسودات"), "drafts.title": ("Ready-to-send drafts", "مسودات جاهزة للإرسال"),
"drafts.note": ("The app never sends anything. Edit the text if you wish, send it yourself, then mark it as sent.", "لا يرسل التطبيق شيئاً. عدّل النص إن شئت وأرسله بنفسك ثم علّمه مُرسَلاً."),
"drafts.empty": ("Drafts appear here after you approve an order or decide on an offer.", "تظهر المسودات هنا بعد اعتماد طلب أو البتّ في عرض."),
"drafts.to": ("To", "إلى"), "drafts.to_waiting": ("Companies waiting for space", "الشركات المنتظرة للمساحة"),
"drafts.sent": ("Sent", "مُرسَلة"), "drafts.not_sent": ("Not sent", "غير مُرسَلة"),
"drafts.mark_sent": ("Mark as sent", "علّمها مُرسَلة"), "drafts.mark_unsent": ("Mark as not sent", "علّمها غير مُرسَلة"),
"drafts.edit": ("Edit text", "تعديل النص"), "drafts.save": ("Save text", "حفظ النص"), "drafts.cancel": ("Cancel", "إلغاء"), "drafts.edited": ("edited", "معدّلة"),
"drafts.kind.SUPPLIER_ORDER": ("Order to the supplier", "طلب إلى المورد"), "drafts.kind.SPACE_REPLY": ("Reply to a company", "رد على شركة"),
"drafts.lang.ar": ("Arabic", "العربية"), "drafts.lang.en": ("English", "الإنجليزية"),
"draft.po.subject": ("Purchase order {po}: {qty:n0} {unit:unit} of {item:item}", "أمر شراء {po}: {qty:n0} {unit:unit} من {item:item}"),
"draft.po.body": ("Dear {supplier},\n\nPlease supply {qty:n0} {unit:unit} of {item:item} under purchase order {po}{emerg:emerg}.\nRequested delivery date: {date:date}.\nBudget reference: purchasing period {start:date} to {end:date}, order value {cost:omr}.\n\nPlease confirm the order and the delivery date by return.\nThank you.", "السادة {supplier} المحترمين،\n\nنرجو توريد {qty:n0} {unit:unit} من {item:item} بموجب أمر الشراء {po}{emerg:emerg}.\nتاريخ التسليم المطلوب: {date:date}.\nمرجع الميزانية: فترة المشتريات من {start:date} إلى {end:date}، قيمة الطلب {cost:omr}.\n\nنرجو تأكيد الطلب وموعد التسليم بالرد.\nشكراً لكم."),
"draft.sp.why_generic": ("it does not fit our plan for this space", "لا يناسب خطتنا لهذه المساحة"),
"draft.sp.accept.subject": ("Your offer for {area:m2} in {zone:zname} is accepted", "قبول عرضكم لـ {area:m2} في {zone:zname}"),
"draft.sp.accept.body": ("Dear {company},\n\nThank you for your offer. We accept it: {area:m2} in {zone:zname} from {start:date} to {end:date} at {price:omr} per m² per month.\nWe will send the rental agreement for signature.\n\nBest regards", "السادة {company} المحترمين،\n\nشكراً لعرضكم. نقبله: {area:m2} في {zone:zname} من {start:date} إلى {end:date} بسعر {price:omr} للمتر المربع شهرياً.\nسنرسل عقد الإيجار للتوقيع.\n\nمع التحية"),
"draft.sp.reject.subject": ("About your offer for {area:m2} in {zone:zname}", "بشأن عرضكم لـ {area:m2} في {zone:zname}"),
"draft.sp.reject.body": ("Dear {company},\n\nThank you for your offer for {area:m2} from {start:date} to {end:date}. We are sorry that we cannot accept it.\nReason: {why:msg}\nYou are welcome to send another offer.\n\nBest regards", "السادة {company} المحترمين،\n\nشكراً لعرضكم لـ {area:m2} من {start:date} إلى {end:date}. نأسف لعدم قدرتنا على قبوله.\nالسبب: {why:msg}\nيسعدنا أن تقدّموا عرضاً آخر.\n\nمع التحية"),
"draft.sp.counter.subject": ("Our counter-offer for {zone:zname}", "عرضنا المقابل لـ {zone:zname}"),
"draft.sp.counter.body": ("Dear {company},\n\nThank you for your offer for {area:m2} from {start:date} to {end:date} at {price:omr}. We cannot accept it as it stands.\nReason: {why:msg}\nWe can offer {c_area:m2} from {c_start:date} to {c_end:date} at {c_price:omr} per m² per month. Please tell us whether this suits you.\n\nBest regards", "السادة {company} المحترمين،\n\nشكراً لعرضكم لـ {area:m2} من {start:date} إلى {end:date} بسعر {price:omr}. لا يمكننا قبوله كما هو.\nالسبب: {why:msg}\nيمكننا أن نعرض {c_area:m2} من {c_start:date} إلى {c_end:date} بسعر {c_price:omr} للمتر المربع شهرياً. يرجى إفادتنا إن كان يناسبكم.\n\nمع التحية"),
"draft.sp.vacant.subject": ("Space in {zone:zname} is not offered for rent now", "مساحة في {zone:zname} غير معروضة للإيجار حالياً"),
"draft.sp.vacant.body": ("Dear companies waiting for storage space,\n\nThe {area:m2} in {zone:zname} from {start:date} to {end:date} are not offered for rent now.\nReason: {why:msg} {note}\nWe will look at it again on {reeval:date}.\n\nBest regards", "السادة الشركات المنتظرة لمساحة تخزين،\n\nالمساحة {area:m2} في {zone:zname} من {start:date} إلى {end:date} غير معروضة للإيجار حالياً.\nالسبب: {why:msg} {note}\nسنعيد النظر فيها بتاريخ {reeval:date}.\n\nمع التحية"),
"draft.sp.vacant.why": ("we are keeping this space for our own use for now", "نحتفظ بهذه المساحة لاستخدامنا حالياً"),
# ---- glossary and demo script additions
"gl.agent.term": ("Agent", "الوكيل"), "gl.agent.def": ("A small program that reads the database, applies rules, writes its result and checks itself. The five agents hand work to each other through the database; they do not use an AI model.", "برنامج صغير يقرأ قاعدة البيانات ويطبّق قواعد ويكتب نتيجته ويفحص نفسه. يسلّم الوكلاء الخمسة العمل لبعضهم عبر قاعدة البيانات؛ ولا يستخدمون نموذج ذكاء اصطناعي."),
"gl.stages.term": ("Read, Reason, Act, Verify", "قراءة، استنتاج، تنفيذ، تحقق"), "gl.stages.def": ("The four stages every agent logs: what it read, what it decided, what it wrote, and the result of its own check.", "المراحل الأربع التي يسجلها كل وكيل: ما قرأه وما قرره وما كتبه ونتيجة فحصه الذاتي."),
"gl.verify.term": ("Self-check", "الفحص الذاتي"), "gl.verify.def": ("A quick test an agent runs on its own result. If it fails the agent runs again once; if it still fails, a warning is shown and the simulation goes on.", "اختبار سريع يجريه الوكيل على نتيجته. إن فشل أُعيد تشغيله مرة؛ وإن فشل ثانية يظهر تحذير وتستمر المحاكاة."),
"gl.draft.term": ("Draft", "المسودة"), "gl.draft.def": ("A ready-to-send message: the order to a supplier after you approve a purchase, or the reply to a company after you decide on its offer. You can edit it; the app never sends it.", "رسالة جاهزة للإرسال: الطلب إلى المورد بعد اعتماد الشراء أو الرد على شركة بعد البتّ في عرضها. يمكنك تعديلها؛ ولا يرسلها التطبيق."),
"gl.summary.term": ("Daily summary", "الملخص اليومي"), "gl.summary.def": ("One card built from the database after the 08:00 run: top risks, decisions waiting, budget, space and offers.", "بطاقة واحدة مبنية من قاعدة البيانات بعد تشغيل الساعة 08:00: أهم المخاطر والقرارات المنتظرة والميزانية والمساحات والعروض."),
"demo.s13": ("Open “Agents” under “More”: every run shows its four stages (Read, Reason, Act, Verify) for each of the five agents, with a check mark or a cross for its own check.", "افتح «الوكلاء» تحت «المزيد»: يعرض كل تشغيل مراحله الأربع (قراءة، استنتاج، تنفيذ، تحقق) لكل وكيل من الخمسة، مع علامة صح أو خطأ لفحصه الذاتي."),
"demo.s14": ("Open Help, then “How the agents work”: the flow, one card per agent (what it reads and writes, when it runs, its last self-check) and where you approve.", "افتح المساعدة ثم «كيف يعمل الوكلاء»: المسار وبطاقة لكل وكيل (ما يقرأ ويكتب ومتى يعمل ونتيجة آخر فحص ذاتي) وأين تعتمد."),
"demo.s15": ("After you approve an order or answer an offer, open “Drafts”: the message to the supplier or the company is ready in both languages. Edit it, send it yourself, and mark it as sent.", "بعد اعتماد طلب أو الرد على عرض افتح «المسودات»: الرسالة إلى المورد أو الشركة جاهزة بالعربية والإنجليزية. عدّلها وأرسلها بنفسك ثم علّمها مُرسَلة."),
}

REMOVE = ["agent.space", "agent.spaceplan"]

if __name__ == "__main__":
    for lang, idx in (("en", 0), ("ar", 1)):
        path = f"locales/{lang}.json"
        cur = json.load(open(path, encoding="utf8"))
        for k in REMOVE:
            cur.pop(k, None)
        cur.update({k: v[idx] for k, v in W.items()})
        json.dump(cur, open(path, "w", encoding="utf8"), ensure_ascii=False, indent=1)
    print(len(W), "agent keys")
