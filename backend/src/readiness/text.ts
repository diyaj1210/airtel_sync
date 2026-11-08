import type { Lang } from "../advisor/text.js";
import type { Bilingual } from "./types.js";

/**
 * Wording of blockers (One-Sitting Completion), English and Hindi. A blocker about a KYC problem
 * uses the app's own sentence for that problem (channels/sharedText.ts, generated from the app);
 * the action, the expected resolution and the readiness-only messages are written here.
 */
const TEXT = {
  en: {
    // actions
    "action.upload": "Upload a clear photo of your {doc}.",
    "action.uploadAgain": "Take a new photo of your {doc} and upload it again.",
    "action.photoTips": "Take a new photo of your {doc}: lay the page flat in good light, avoid glare and shadows, fit the whole page in the frame and hold the phone steady.",
    "action.recentBill": "Upload an electricity bill dated on or after {date}.",
    "action.validId": "Upload an ID of the person signing that is still valid.",
    "action.billAddress": "Upload a bill for the installation address shown in your GST registration.",
    "action.confirmGstin": "Did you mean {gstin} ({name})? Tap to confirm, and we will use your registered GSTIN.",
    "action.checkGstin": "Check the GSTIN you entered, or upload a clear photo of your GST certificate.",
    "action.ownerLink": "Send a signing link to the registered owner ({owner}). They approve you as the person signing for the business (MOCK e-sign).",
    "action.ownerLinkSent": "We sent a signing link to the registered owner ({owner}) (MOCK). This is settled as soon as they sign.",
    "action.waitReview": "Nothing to do now: our operations team is checking this. Meanwhile you can answer the question below or upload a clearer document.",
    "action.withoutGstin": "Continue with {bundle} without the products that need an active GSTIN: {monthly}/month.",
    "action.airfiber": "Continue with {bundle} on 5G AirFiber, ready in about {days} days: {monthly}/month.",
    "action.requote": "Get the same bundle again at today's prices: {monthly}/month.",
    "action.getQuote": "Get a quote for your bundle, then come back to pay. Your verification is kept.",
    "action.partner": "{partner} will contact you to plan the installation. You can still finish everything here.",
    "action.saveReturn": "Save your application and come back later with reference {id}; we keep everything you have done.",
    "action.rejected": "Upload other documents, or ask for a call back.",
    // customer messages that are not KYC-check problems
    "msg.gstinBlocked": "Your GSTIN is {status} in the GST registry, so these products cannot be activated: {products}.",
    "msg.gstinMissing": "These products need an active GSTIN, which your business does not have: {products}.",
    "msg.noFibre": "MOCK coverage check: wired internet (fibre / leased line) is not available in {city} yet.",
    "msg.noFibreNoFallback": "MOCK coverage check: wired internet is not available in {city} yet, and no wireless bundle fits your business.",
    "msg.quoteExpired": "Your quote expired on {date}.",
    "msg.noQuote": "This application is not linked to a quote yet.",
    "msg.partner": "Partner assistance recommended: {reasons}.",
    "msg.rejected": "Our team could not approve these details. {note}",
    "reason.leasedLine": "a leased line",
    "reason.sdwan": "SD-WAN across sites",
    "reason.sites": "{n} locations",
    "reason.value": "more than ₹10,000 a month",
    "reason.install": "an installation window of {days} days",
    // expected resolution
    "eta.now": "Now: about {minutes} minutes.",
    "eta.review": "Within 4 working hours (MOCK service level), by the operations team.",
    "eta.owner": "As soon as the registered owner signs.",
    "eta.partner": "A partner calls within 1 working day (MOCK service level).",
    "eta.choice": "Now, as soon as you choose.",
    // questions to the owner (K07)
    "question.legalName": "The legal name on your GST certificate is different from the GST registry. Has your business's legal name changed, or is this an older certificate?",
    "question.tradeName": "The trade name on your GST certificate is different from the GST registry. Which trade name does your business use now?",
    "question.address": "The address on your GST certificate is different from the GST registry. Has your business moved?",
    "question.constitution": "The business type on your GST certificate is different from the GST registry. Has the business type changed (for example, proprietorship to LLP)?",
    "question.billName": "The electricity bill is in another name. Whose name is it in, and how are they related to the business?",
    "question.billDate": "The bill date is in the future. Could you check the date on the bill?",
    "question.notInRegistry": "Your GST certificate shows a GSTIN the registry does not know. When was it issued?",
  },
  hi: {
    "action.upload": "अपने {doc} की साफ़ फ़ोटो अपलोड करें।",
    "action.uploadAgain": "अपने {doc} की नई फ़ोटो लेकर फिर से अपलोड करें।",
    "action.photoTips": "अपने {doc} की नई फ़ोटो लें: पन्ना अच्छी रोशनी में सपाट रखें, चमक और छाया से बचें, पूरा पन्ना फ़्रेम में रखें और फ़ोन स्थिर रखें।",
    "action.recentBill": "{date} या उसके बाद की तारीख़ वाला बिजली बिल अपलोड करें।",
    "action.validId": "हस्ताक्षर करने वाले व्यक्ति का ऐसा पहचान पत्र अपलोड करें जो अभी मान्य हो।",
    "action.billAddress": "अपने GST पंजीकरण में दिखाए गए इंस्टॉलेशन पते का बिल अपलोड करें।",
    "action.confirmGstin": "क्या आपका मतलब {gstin} ({name}) था? पुष्टि के लिए दबाएँ, हम आपका पंजीकृत GSTIN नंबर इस्तेमाल करेंगे।",
    "action.checkGstin": "आपने जो GSTIN नंबर लिखा उसे जाँचें, या अपने GST प्रमाणपत्र की साफ़ फ़ोटो अपलोड करें।",
    "action.ownerLink": "पंजीकृत मालिक ({owner}) को हस्ताक्षर का लिंक भेजें। वे आपको व्यवसाय की ओर से हस्ताक्षर करने की मंज़ूरी देंगे (MOCK ई-साइन)।",
    "action.ownerLinkSent": "हमने पंजीकृत मालिक ({owner}) को हस्ताक्षर का लिंक भेजा (MOCK)। उनके हस्ताक्षर करते ही यह हल हो जाएगा।",
    "action.waitReview": "अभी कुछ नहीं करना है: हमारी ऑपरेशंस टीम इसे जाँच रही है। तब तक आप नीचे दिए सवाल का जवाब दे सकते हैं या साफ़ दस्तावेज़ अपलोड कर सकते हैं।",
    "action.withoutGstin": "चालू GSTIN नंबर वाले प्रोडक्ट के बिना {bundle} के साथ आगे बढ़ें: {monthly}/महीना।",
    "action.airfiber": "5G AirFiber पर {bundle} के साथ आगे बढ़ें, लगभग {days} दिन में तैयार: {monthly}/महीना।",
    "action.requote": "यही बंडल आज की क़ीमत पर फिर से लें: {monthly}/महीना।",
    "action.getQuote": "अपने बंडल का कोटेशन लें, फिर भुगतान के लिए लौटें। आपकी जाँच सुरक्षित रहेगी।",
    "action.partner": "{partner} इंस्टॉलेशन की योजना के लिए आपसे संपर्क करेंगे। आप फिर भी सब कुछ यहीं पूरा कर सकते हैं।",
    "action.saveReturn": "अपना आवेदन सेव करें और बाद में संदर्भ {id} के साथ लौटें; आपका किया हुआ सब सुरक्षित रहेगा।",
    "action.rejected": "दूसरे दस्तावेज़ अपलोड करें, या वापस फ़ोन माँगें।",
    "msg.gstinBlocked": "GST रजिस्ट्री में आपका GSTIN नंबर {status} है, इसलिए ये प्रोडक्ट चालू नहीं हो सकते: {products}।",
    "msg.gstinMissing": "इन प्रोडक्ट के लिए चालू GSTIN नंबर चाहिए, जो आपके व्यवसाय के पास नहीं है: {products}।",
    "msg.noFibre": "MOCK कवरेज जाँच: {city} में अभी तार वाला इंटरनेट (फ़ाइबर / लीज़्ड लाइन) उपलब्ध नहीं है।",
    "msg.noFibreNoFallback": "MOCK कवरेज जाँच: {city} में अभी तार वाला इंटरनेट उपलब्ध नहीं है, और कोई वायरलेस बंडल आपके व्यवसाय के लिए उपयुक्त नहीं है।",
    "msg.quoteExpired": "आपके कोटेशन की अवधि {date} को ख़त्म हो गई।",
    "msg.noQuote": "यह आवेदन अभी किसी कोटेशन से जुड़ा नहीं है।",
    "msg.partner": "पार्टनर की मदद की सलाह: {reasons}।",
    "msg.rejected": "हमारी टीम इन जानकारियों को मंज़ूर नहीं कर सकी। {note}",
    "reason.leasedLine": "लीज़्ड लाइन",
    "reason.sdwan": "कई जगहों पर SD-WAN",
    "reason.sites": "{n} जगहें",
    "reason.value": "₹10,000 प्रति माह से ज़्यादा",
    "reason.install": "{days} दिन का इंस्टॉलेशन समय",
    "eta.now": "अभी: लगभग {minutes} मिनट।",
    "eta.review": "4 कामकाजी घंटों के भीतर (MOCK सेवा स्तर), ऑपरेशंस टीम द्वारा।",
    "eta.owner": "जैसे ही पंजीकृत मालिक हस्ताक्षर करें।",
    "eta.partner": "1 कामकाजी दिन के भीतर पार्टनर फ़ोन करेंगे (MOCK सेवा स्तर)।",
    "eta.choice": "अभी, जैसे ही आप चुनें।",
    "question.legalName": "आपके GST प्रमाणपत्र पर क़ानूनी नाम GST रजिस्ट्री से अलग है। क्या आपके व्यवसाय का क़ानूनी नाम बदला है, या यह पुराना प्रमाणपत्र है?",
    "question.tradeName": "आपके GST प्रमाणपत्र पर व्यापारिक नाम GST रजिस्ट्री से अलग है। आपका व्यवसाय अभी कौन-सा व्यापारिक नाम इस्तेमाल करता है?",
    "question.address": "आपके GST प्रमाणपत्र पर पता GST रजिस्ट्री से अलग है। क्या आपका व्यवसाय दूसरी जगह चला गया है?",
    "question.constitution": "आपके GST प्रमाणपत्र पर व्यवसाय का प्रकार GST रजिस्ट्री से अलग है। क्या व्यवसाय का प्रकार बदला है (जैसे प्रोप्राइटरशिप से LLP)?",
    "question.billName": "बिजली बिल किसी और के नाम पर है। यह किसके नाम पर है, और उनका व्यवसाय से क्या संबंध है?",
    "question.billDate": "बिल की तारीख़ भविष्य की है। क्या आप बिल पर तारीख़ जाँच सकते हैं?",
    "question.notInRegistry": "आपके GST प्रमाणपत्र पर ऐसा GSTIN नंबर है जो रजिस्ट्री में नहीं है। यह कब जारी हुआ था?",
  },
} as const;

export type ReadinessKey = keyof (typeof TEXT)["en"];
type Vars = Record<string, string | number>;

const fill = (template: string, vars: Vars) => template.replace(/\{(\w+)\}/g, (w, n: string) => (n in vars ? String(vars[n]) : w));

export function rt(lang: Lang, key: ReadinessKey, vars: Vars = {}): string {
  return fill(TEXT[lang][key], vars);
}

/** The same message in both languages; vars may differ per language (e.g. translated document names). */
export function both(key: ReadinessKey, vars: Vars | ((lang: Lang) => Vars) = {}): Bilingual {
  const v = (lang: Lang) => (typeof vars === "function" ? vars(lang) : vars);
  return { en: rt("en", key, v("en")), hi: rt("hi", key, v("hi")) };
}

export const READINESS_TEXT = TEXT;
