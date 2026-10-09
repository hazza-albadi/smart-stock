# Texts of the public website (home, available spaces, sign-in). The pages are Arabic only; English values exist only because both files must hold the same keys. Runs last.
import json

W = {
"site.brand": ("SmartStock", "سمارت ستوك"),
"site.nav.label": ("Main navigation", "التنقل الرئيسي"),
"site.nav.home": ("Home", "الرئيسية"), "site.nav.spaces": ("Available spaces", "المساحات المتاحة"),
"site.nav.login": ("Sign in", "تسجيل الدخول"), "site.nav.logout": ("Sign out", "تسجيل الخروج"), "site.nav.workspace": ("Back to the workspace", "العودة إلى النظام"),
"site.footer": ("All rights reserved to SmartStock.", "جميع الحقوق محفوظة لشركة سمارت ستوك."),
"site.home.title": ("Smart management of warehouses and storage space", "إدارة ذكية للمخازن ومساحات التخزين"),
"site.home.sub": ("We help you rent out empty storage space and follow your stock clearly, with decisions you can trust.", "نساعدك على تأجير مساحات التخزين الفارغة وعلى متابعة المخزون بوضوح وبقرارات مدروسة."),
"site.home.cta_spaces": ("Browse available spaces", "تصفّح المساحات المتاحة"), "site.home.cta_login": ("Sign in", "تسجيل الدخول"),
"site.home.what_title": ("What we do", "ماذا نقدّم"),
"site.home.what_text": ("Storage space for rent and stock follow-up in one place, so you know what you have, what you need and what you can rent out.", "مساحات تخزين للإيجار ومتابعة للمخزون في مكان واحد، لتعرف ما لديك وما تحتاجه وما يمكنك تأجيره."),
"site.home.v1_title": ("Space ready to rent", "مساحات جاهزة للإيجار"), "site.home.v1_text": ("We list the empty space in our warehouse with its area, price and the dates it is available.", "نعرض المساحات الفارغة في مستودعنا بمساحتها وسعرها وفترة إتاحتها."),
"site.home.v2_title": ("Clear stock follow-up", "متابعة واضحة للمخزون"), "site.home.v2_text": ("Quantities, deliveries and expiry dates are followed so nothing runs out unnoticed.", "نتابع الكميات والتوريدات وتواريخ الصلاحية حتى لا ينفد شيء دون أن تعلم."),
"site.home.v3_title": ("Decisions you approve", "قرارات تعتمدها أنت"), "site.home.v3_text": ("Suggestions are prepared for you; nothing is ordered or rented until a person approves it.", "تُجهَّز لك الاقتراحات، ولا يُطلب شيء ولا يُؤجَّر حتى يعتمده إنسان."),
"site.spaces.title": ("Spaces available for rent", "المساحات المتاحة للإيجار"),
"site.spaces.sub": ("Storage space currently offered for rent. Request a visit and we will contact you.", "مساحات تخزين معروضة حالياً للإيجار. اطلب زيارة وسنتواصل معك."),
"site.spaces.filters": ("Filter the spaces", "تصفية المساحات"),
"site.spaces.area_min": ("Area from (m²)", "المساحة من (م²)"), "site.spaces.area_max": ("Area to (m²)", "المساحة إلى (م²)"),
"site.spaces.price_min": ("Price from", "السعر من"), "site.spaces.price_max": ("Price to", "السعر إلى"),
"site.spaces.zone": ("Zone", "المنطقة"), "site.spaces.zone_all": ("All zones", "كل المناطق"), "site.spaces.reset": ("Reset filters", "إعادة ضبط التصفية"),
"site.spaces.count": ("{n} space(s) shown", "عدد المساحات المعروضة: {n}"),
"site.spaces.area": ("Area", "المساحة"), "site.spaces.price": ("Price", "السعر"), "site.spaces.per": ("per m² per month", "لكل متر مربع شهرياً"),
"site.spaces.available": ("Available", "متاحة"), "site.spaces.range": ("from {from} to {to}", "من {from} إلى {to}"), "site.spaces.dates_open": ("Dates to be agreed", "تُحدَّد التواريخ بالاتفاق"),
"site.spaces.conditions": ("Conditions", "الظروف"), "site.spaces.storage": ("Storage type", "نوع التخزين"),
"site.spaces.cond_general": ("General goods only; no raw materials or chemicals.", "بضائع عامة فقط، دون مواد خام أو كيماوية."),
"site.spaces.sample": ("Sample", "نموذج"), "site.spaces.sample_note": ("These are sample listings for illustration, not real spaces.", "هذه عروض نموذجية للتوضيح وليست مساحات فعلية."),
"site.spaces.visit": ("Request a visit", "اطلب زيارة"),
"site.spaces.empty_title": ("No spaces are listed right now", "لا توجد مساحات معروضة حالياً"), "site.spaces.empty_text": ("Please check again later.", "يرجى المراجعة لاحقاً."),
"site.spaces.none_match": ("No space matches the filters.", "لا توجد مساحة تطابق التصفية."),
"site.spaces.loading": ("Loading the spaces…", "جارٍ تحميل المساحات…"), "site.spaces.error": ("The spaces could not be loaded.", "تعذّر تحميل المساحات."),
"site.visit.title": ("Request a visit", "طلب زيارة"), "site.visit.chosen": ("Chosen space", "المساحة المختارة"),
"site.visit.name": ("Name", "الاسم"), "site.visit.company": ("Company", "الشركة"), "site.visit.phone": ("Phone number", "رقم الهاتف"), "site.visit.message": ("Message", "رسالتك"),
"site.visit.submit": ("Send the request", "إرسال الطلب"),
"site.visit.err_name": ("Enter your name.", "أدخل اسمك."), "site.visit.err_phone": ("Enter a valid phone number.", "أدخل رقم هاتف صحيحاً."),
"site.visit.thanks": ("Thank you. This is a demonstration form: your details are not saved.", "شكراً لك. هذا نموذج تجريبي: لا تُحفظ بياناتك."),
"site.login.title": ("Sign in", "تسجيل الدخول"), "site.login.email": ("Email", "البريد الإلكتروني"), "site.login.password": ("Password", "كلمة المرور"),
"site.login.submit": ("Sign in", "تسجيل الدخول"), "site.login.error": ("The entered details are incorrect", "البيانات المدخلة غير صحيحة"),
"site.login.or": ("or", "أو"), "site.login.trial": ("Trial sign-in", "تسجيل تجريبي"), "site.login.trial_note": ("Look around the system without an account.", "تصفّح النظام دون حساب."),
}

if __name__ == "__main__":
    for lang, idx in (("en", 0), ("ar", 1)):
        path = f"locales/{lang}.json"
        cur = json.load(open(path, encoding="utf8"))
        cur.update({k: v[idx] for k, v in W.items()})
        json.dump(cur, open(path, "w", encoding="utf8"), ensure_ascii=False, indent=1)
    print(len(W), "site keys")
