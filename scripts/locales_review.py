# Texts added by the simulation review (docs/SIM_REVIEW.md): refusals in plain words, settings validation, and the demo experience. Runs last (after locales_site.py).
import json

W = {
# ---- settings are checked before they are stored (SIM_REVIEW C1)
"settings.err.type": ("{key}: this setting needs {kind:msg}.", "{key}: هذا الإعداد يحتاج {kind:msg}."),
"settings.kind.number": ("a number", "رقماً"),
"settings.kind.boolean": ("true or false", "true أو false"),
"settings.kind.text": ("a text in quotes", "نصاً بين علامتي تنصيص"),
"settings.kind.list": ("a list in square brackets, for example [6] or [8, 14]", "قائمة بين قوسين مربعين، مثل [6] أو [8, 14]"),
"settings.kind.object": ("an object in curly brackets, like the current value", "كائناً بين قوسين معقوفين، مثل القيمة الحالية"),
"settings.err.min": ("{key}: the value must be at least {min:n2}.", "{key}: يجب ألا تقل القيمة عن {min:n2}."),
"settings.err.max": ("{key}: the value must be at most {max:n2}.", "{key}: يجب ألا تزيد القيمة عن {max:n2}."),
"settings.err.hours": ("{key}: every hour must be a whole number from 0 to 23.", "{key}: يجب أن تكون كل ساعة عدداً صحيحاً من 0 إلى 23."),
"settings.err.date": ("{key}: use a date like 2026-10-05.", "{key}: استخدم تاريخاً بالشكل 2026-10-05."),
"settings.err.unknown": ("{key}: there is no such setting.", "{key}: لا يوجد إعداد بهذا الاسم."),
"settings.err.json": ("{key}: the value could not be read. Keep the same form as the current value.", "{key}: تعذرت قراءة القيمة. احتفظ بنفس شكل القيمة الحالية."),
"settings.saved": ("Saved: {key}.", "حُفظ: {key}."),
# ---- refusals in the user's language instead of raw English (SIM_REVIEW M2)
"err.server": ("Something went wrong on the server. Nothing was changed. Details: {detail}", "حدث خطأ في الخادم ولم يتغير شيء. التفاصيل: {detail}"),
"err.network": ("The server cannot be reached. Check that it is still running, then try again.", "تعذر الوصول إلى الخادم. تأكد أنه يعمل ثم حاول مرة أخرى."),
"err.not_found": ("This suggestion no longer exists. The screen has been refreshed.", "هذا الاقتراح لم يعد موجوداً. حُدّثت الشاشة."),
"err.already_decided": ("This suggestion was already decided (maybe in another tab). The screen has been refreshed.", "تم البتّ في هذا الاقتراح مسبقاً (ربما في تبويب آخر). حُدّثت الشاشة."),
"err.not_pending": ("Only a suggestion that is still waiting can be changed.", "يمكن تعديل الاقتراح المنتظر فقط."),
"err.qty_min": ("The quantity must be at least 1.", "يجب ألا تقل الكمية عن 1."),
"err.unknown_item": ("This item does not exist.", "هذا الصنف غير موجود."),
"err.reason_required": ("Please give a reason.", "يرجى ذكر السبب."),
"err.bad_qty": ("Please enter a whole quantity (not zero).", "يرجى إدخال كمية صحيحة (غير صفر)."),
"err.not_enough_stock": ("There is not enough stock for this: {have:n0} on hand.", "لا يوجد مخزون كافٍ لذلك: المتاح {have:n0}."),
"err.no_room_receipt": ("There is no room in the warehouse for this receipt.", "لا توجد مساحة في المستودع لهذا الاستلام."),
"err.bad_request": ("Please check the company name, area, months and start date.", "يرجى التحقق من اسم الشركة والمساحة وعدد الأشهر وتاريخ البدء."),
"err.cannot_undo": ("This can no longer be undone: something has happened since.", "لم يعد بالإمكان التراجع: حدث شيء منذ ذلك الحين."),
"err.po_moved": ("This can no longer be undone: the order has already arrived or changed.", "لم يعد بالإمكان التراجع: الطلب وصل أو تغيّر."),
"err.bad_action": ("This action is not known.", "هذا الإجراء غير معروف."),
"err.clock_stopped": ("The clock stopped because the last hour could not be run. It is paused now; press Start to try again.", "توقفت الساعة لأن الساعة الأخيرة تعذر تشغيلها. هي متوقفة الآن؛ اضغط «ابدأ» للمحاولة مرة أخرى."),
# ---- the "zone over capacity" alert gets its if-ignored message (SIM_REVIEW m1)
"alert.space_over.ignore": ("Goods may be stored in aisles or outside the zone, which is unsafe, and new deliveries for {zone} cannot be received.", "قد تُخزَّن البضائع في الممرات أو خارج المنطقة، وهذا غير آمن، ولا يمكن استلام شحنات جديدة لـ {zone}."),
# ---- months with the right Arabic agreement (SIM_REVIEW m5): "٦ شهر" -> "٦ أشهر", "١٢ شهراً", "شهرين"
"dur.month.one": ("month", "شهر"), "dur.month.two": ("months", "شهرين"), "dur.month.few": ("months", "أشهر"), "dur.month.many": ("months", "شهراً"), "dur.month.other": ("months", "شهر"),
"sp.btn.list": ("List {area:m2} for {months:months} at {price:omr} per m²", "اعرض {area:m2} للإيجار لمدة {months:months} بسعر {price:omr} للمتر"),
"sp.unmatched.line": ("for {months:months} from {from:date}", "لمدة {months:months} ابتداءً من {from:date}"),
# ==== demo experience (Phase 3) ====
# ---- time controls: jump to the next important event
"top.next_event": ("Next event", "الحدث التالي"),
"top.next_event_hint": ("Run hour by hour until something needs a look: an alert, a delivery, an offer, a new decision", "شغّل ساعة بساعة حتى يحدث ما يستحق النظر: تنبيه أو شحنة أو عرض أو قرار جديد"),
"next.stop_event": ("After {h:dur}: {ev:msg}", "بعد {h:dur}: {ev:msg}"),
"next.stop_decision": ("After {h:dur}: a new decision is waiting for you ({n:n0} in total).", "بعد {h:dur}: قرار جديد بانتظارك (المجموع {n:n0})."),
"next.stop_none": ("Nothing important happened in {h:dur}.", "لم يحدث شيء مهم خلال {h:dur}."),
}

if __name__ == "__main__":
    for lang, idx in (("en", 0), ("ar", 1)):
        path = f"locales/{lang}.json"
        cur = json.load(open(path, encoding="utf8"))
        cur.update({k: v[idx] for k, v in W.items()})
        json.dump(cur, open(path, "w", encoding="utf8"), ensure_ascii=False, indent=1)
    print(len(W), "review keys")
