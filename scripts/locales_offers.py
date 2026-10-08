# Texts of the more reliable offers: suggestions when nobody answers, side-by-side comparison. English + Arabic. Runs after locales_budget.py.
import json

W = {
"sp.kind.advice": ("Nobody answered", "لم يرد أحد"),
"sp.advice.title": ("The listing in {zone:zone} got no offer in {days:n0} days", "لم يصل أي عرض لإعلان {zone:zone} خلال {days:n0} أيام"),
"sp.advice.why_high": ("You ask {price:omr} per m² and the market is about {market:omr}: companies stay away from prices this high.", "تطلب {price:omr} للمتر والسوق حوالي {market:omr}: تبتعد الشركات عن أسعار بهذا الارتفاع."),
"sp.advice.why_ok": ("The price ({price:omr} per m²) is in line with the market ({market:omr}); the area or dates may not suit the companies that look.", "السعر ({price:omr} للمتر) قريب من السوق ({market:omr})؛ وقد لا تناسب المساحة أو التواريخ الشركات الباحثة."),
"sp.advice.opts_high": ("Lower the price, widen the dates, offer a smaller area, or split the listing in two.", "اخفض السعر أو وسّع التواريخ أو اعرض مساحة أصغر أو قسّم الإعلان إلى اثنين."),
"sp.advice.opts_ok": ("Widen the dates, offer a smaller area, split the listing in two, or lower the price a little.", "وسّع التواريخ أو اعرض مساحة أصغر أو قسّم الإعلان إلى اثنين أو اخفض السعر قليلاً."),
"sp.btn.reprice": ("Lower the price to {price:omr} per m²", "اخفض السعر إلى {price:omr} للمتر"),
"toast.sp.repriced": ("Price of the listing in {zone:zone} is now {price:omr} per m². New offers will arrive.", "أصبح سعر إعلان {zone:zone} {price:omr} للمتر. ستصل عروض جديدة."),
"sp.list.why_high": ("No offers yet: the price is above the market band, so companies stay away.", "لا عروض بعد: السعر أعلى من نطاق السوق لذلك تبتعد الشركات."),
"sp.list.waiting": ("Waiting for offers: the first ones usually arrive within {days:n0} days.", "بانتظار العروض: تصل الأولى عادة خلال {days:n0} أيام."),
"alert.sp.no_offers.title": ("The listing in {zone:zone} got no offer in {days:n0} days", "لم يصل أي عرض لإعلان {zone:zone} خلال {days:n0} أيام"),
"alert.sp.no_offers.d1": ("The price ({price:omr} per m²) is close to the market ({market:omr}). Widen the dates, offer a smaller area, split the listing, or lower the price to {suggest:omr}.", "السعر ({price:omr} للمتر) قريب من السوق ({market:omr}). وسّع التواريخ أو اعرض مساحة أصغر أو قسّم الإعلان أو اخفض السعر إلى {suggest:omr}."),
"alert.sp.no_offers.d_high": ("The price ({price:omr} per m²) is above the market ({market:omr}) and companies stay away. Lower it to {suggest:omr}, widen the dates, or split the listing.", "السعر ({price:omr} للمتر) أعلى من السوق ({market:omr}) وتبتعد الشركات. اخفضه إلى {suggest:omr} أو وسّع التواريخ أو قسّم الإعلان."),
"alert.sp.no_offers.ignore": ("The space stays empty and earns nothing.", "تبقى المساحة فارغة دون دخل."),
"alert.prop.NO_OFFERS": ("Lower the price, widen the dates or area, or split the listing.", "اخفض السعر أو وسّع التواريخ أو المساحة أو قسّم الإعلان."),
"ev.sp.reprice": ("Listing in {zone:zone} repriced to {price:omr} per m².", "أُعيد تسعير إعلان {zone:zone} إلى {price:omr} للمتر."),
"impact.sp.head.listing_reprice": ("You lowered the price of the listing in {zone:zone} from {was:omr} to {price:omr} on {when:dt}.", "خفضتَ سعر إعلان {zone:zone} من {was:omr} إلى {price:omr} في {when:dt}."),
"impact.sp.e.listing_reprice": ("→ a new waiting window starts: offers are planned again at the new price", "← تبدأ فترة انتظار جديدة: تُخطَّط العروض من جديد بالسعر الجديد"),
"sp.cmp.title": ("Compare offers", "قارن العروض"),
"sp.cmp.sub": ("Offers side by side: the ones you can accept now first, then by total income. Companies, areas and prices are simulated for the demo.", "العروض جنباً إلى جنب: ما يمكن قبوله الآن أولاً ثم الأعلى دخلاً إجمالياً. الشركات والمساحات والأسعار محاكاة للعرض التجريبي."),
"sp.cmp.company": ("Company", "الشركة"), "sp.cmp.area": ("Area", "المساحة"), "sp.cmp.start": ("Starts", "تبدأ"), "sp.cmp.length": ("Length", "المدة"),
"sp.cmp.price": ("Price per m²", "السعر للمتر"), "sp.cmp.monthly": ("Income per month", "الدخل شهرياً"), "sp.cmp.total": ("Total income", "الدخل الإجمالي"),
"sp.cmp.fit": ("Fit with the free window", "الملاءمة للنافذة الفارغة"), "sp.cmp.risk": ("Risk with our orders", "الخطر مع طلباتنا"), "sp.cmp.actions": ("Actions", "الإجراءات"),
"sp.cmp.best": ("Best total", "الأعلى دخلاً"), "sp.cmp.m2": ("{n:m2}", "{n:m2}"), "sp.cmp.months": ("{n:n1} months", "{n:n1} شهر"),
"sp.cmp.fit_inside": ("dates inside", "التواريخ داخل"), "sp.cmp.fit_partly": ("dates partly outside", "التواريخ خارج جزئياً"), "sp.cmp.fit_fits": ("area fits", "المساحة مناسبة"), "sp.cmp.fit_too_big": ("area too big", "المساحة أكبر من المعروض"),
"sp.cmp.risk_none": ("none", "لا يوجد"), "sp.cmp.risk_watch": ("watch: an order may need the space", "انتبه: قد يحتاج طلب المساحة"), "sp.cmp.risk_blocked": ("blocked: we need the space", "ممنوع: نحتاج المساحة"),
}

if __name__ == "__main__":
    for lang, idx in (("en", 0), ("ar", 1)):
        path = f"locales/{lang}.json"
        cur = json.load(open(path, encoding="utf8"))
        cur.update({k: v[idx] for k, v in W.items()})
        json.dump(cur, open(path, "w", encoding="utf8"), ensure_ascii=False, indent=1)
    print(len(W), "offer keys")
