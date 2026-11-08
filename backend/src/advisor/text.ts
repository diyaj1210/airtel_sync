import type { Catalogue } from "../catalogue/catalogue.js";
import type { RuleViolation } from "../catalogue/rules.js";
import type { GstinStatus, ProductId } from "../catalogue/types.js";
import type { BusinessKind, InternetType, Tool } from "./answers.js";

/**
 * Every sentence the advisor writes itself (no-key mode, and the fallback whenever an LLM reply is
 * rejected), in English and Hindi. Product names stay as in the catalogue (brand names).
 */

export const ADVISOR_LANGS = ["en", "hi"] as const;
export type Lang = (typeof ADVISOR_LANGS)[number];

const EN = {
  greeting:
    "Namaste! I'm the Accel Business advisor. I'll ask a few quick questions and suggest the right bundle with one clear monthly price. You can type in English or Hindi.",
  basicMode: "Basic mode: the AI helper is off right now, so short answers work best. Everything else works the same.",
  "ask.businessKind": "What kind of business do you run? Type it (for example “dental clinic” or “kirana store”) or pick one.",
  "ask.employees": "How many people work there, including you?",
  "ask.sites": "How many locations do you have (shops, branches or units)?",
  "ask.city": "Which city is the business in?",
  "ask.gstin": "Do you have a GSTIN?",
  "ask.internet": "What internet do you use at work today?",
  "ask.tools": "Which of these do you already use? Pick all that apply.",
  "kind.shop": "Shop or small service",
  "kind.office": "Office or clinic",
  "kind.chain": "Several branches",
  "kind.factory": "Factory or workshop",
  "gstin.active": "Yes, it is active",
  "gstin.inactive": "Yes, but it is cancelled or suspended",
  "gstin.none": "No GSTIN",
  "internet.none": "No internet",
  "internet.mobile_hotspot": "Mobile hotspot",
  "internet.home_broadband": "Home broadband",
  "internet.business_broadband": "Business broadband",
  "internet.leased_line": "Leased line",
  "tool.pos": "Billing / POS",
  "tool.email": "Business email",
  "tool.cctv": "CCTV",
  "tool.messaging": "WhatsApp or SMS for customers",
  "tools.none": "None of these",
  "tools.done": "Done",
  "city.other": "My city is not in the list",
  "employees.justMe": "Just me",
  "action.human": "Talk to a person",
  "action.restart": "Start again",
  ack: "Noted: {facts}.",
  "ack.employees": "{n} people",
  "ack.employees.one": "just you",
  "ack.sites": "{n} locations",
  "ack.sites.one": "1 location",
  "ack.city.unlisted": "{city} (we'll show products sold in every city)",
  "ack.city.unlistedNoName": "a city not in our list (we'll show products sold in every city)",
  "ack.tools.none": "no billing, email, CCTV or messaging tools yet",
  "ack.tools": "you use {tools}",
  rejected: "Sorry, I couldn't use that answer.",
  "rejected.employees": "Please give the number of people as a whole number from 1 to 100000.",
  "rejected.sites": "Please give the number of locations as a whole number from 1 to 1000.",
  unclear: "Sorry, I didn't catch that.",
  stuck: "I'm having trouble understanding. A person from our team can help: tap “Talk to a person”, or try one of the options below.",
  handoff: "Sure. Leave your mobile number below and a person from our team will call you back.",
  notInterested: "No problem. Could you tell us why? It helps us improve.",
  restarted: "Okay, let's start again.",
  greetingBack: "Hello!",
  "recommend.intro": "For your {business} in {city} ({employees}, {sites}) I recommend {bundle} at {monthly}/month.",
  "recommend.terms": "One-time setup {setup}, contract {contract}, ready in {days}.",
  "recommend.added": "{name} (added): {because}",
  "recommend.unavailable": "Not included for now: {list}",
  "recommend.close": "Tap “See my quote” to change anything, or ask me anything about it.",
  "recommend.updated": "I've updated your bundle with that change.",
  "recommend.business.office": "office",
  "recommend.business.shop": "shop",
  "recommend.business.chain": "business",
  "recommend.business.factory": "unit",
  "because.pos": "you don't use billing software yet; this adds GST-ready billing.",
  "because.cctv": "you don't have CCTV yet.",
  "because.messaging": "you already talk to customers on WhatsApp or SMS; this makes it an official business channel.",
  "internet.context.none": "This gets you online.",
  "internet.context.mobile_hotspot": "It replaces the mobile hotspot you use today.",
  "internet.context.home_broadband": "It replaces home broadband with a business connection.",
  "internet.context.business_broadband": "A business-grade upgrade on your current broadband.",
  "internet.context.leased_line": "It keeps you on a business-grade connection.",
  "product.price": "{price}/month {unit}",
  "product.setup": "+ {setup} one-time setup",
  "product.eligible": "Good news: you can get it.",
  "product.inBundle": "It is already in your bundle.",
  "product.addOn": "You can switch it on in your quote.",
  "product.notInBundle": "It isn't part of your bundle; a person from our team can add it for you.",
  "product.notEligible": "It isn't available for your business: {reasons}",
  "product.requirements": "Who can get it: {reasons}",
  "product.anyone": "Any business can get it.",
  "product.confirmLater": "I'll confirm once I know a bit more about your business.",
  "bundle.summary": "{bundle}: {monthly}/month, one-time setup {setup}, contract {contract}, ready in {days}. These are list prices from our catalogue.",
  "bundle.notYet": "I'll show you one clear monthly price as soon as I know a little more about your business.",
  "noBundle": "I couldn't put together a bundle for these answers. A person from our team can help: tap “Talk to a person”.",
  "reason.CITY_TIER": "Available only in tier-1 (large metro) cities.",
  "reason.MIN_EMPLOYEES": "Needs at least {min} people working at the business.",
  "reason.MIN_SITES": "Needs at least {min} locations.",
  "reason.GSTIN_REQUIRED.none": "Needs an active GSTIN.",
  "reason.GSTIN_REQUIRED.inactive": "Needs an active GSTIN; yours is cancelled or suspended.",
  "reason.REQUIRES_ONE_OF": "Works only together with {products}.",
  or: " or ",
  and: " and ",
  listJoin: ", ",
  "month.one": "{n} month",
  "month.other": "{n} months",
  "day.one": "about {n} day",
  "day.other": "about {n} days",
  perUnit: "{unit}",
  fullStop: ".",
} as const;

export type TextKey = keyof typeof EN;

const HI: Record<TextKey, string> = {
  greeting:
    "नमस्ते! मैं Accel Business का सलाहकार हूँ। मैं कुछ छोटे सवाल पूछकर आपके लिए सही बंडल और एक साफ़ मासिक कीमत बताऊँगा। आप हिंदी या अंग्रेज़ी में लिख सकते हैं।",
  basicMode: "बेसिक मोड: अभी AI सहायक बंद है, इसलिए छोटे जवाब सबसे अच्छे काम करते हैं। बाकी सब पहले जैसा काम करता है।",
  "ask.businessKind": "आपका व्यवसाय किस तरह का है? लिखकर बताइए (जैसे “डेंटल क्लिनिक” या “किराना दुकान”) या नीचे से चुनिए।",
  "ask.employees": "वहाँ कितने लोग काम करते हैं, आप समेत?",
  "ask.sites": "आपकी कितनी जगहें हैं (दुकानें, शाखाएँ या यूनिट)?",
  "ask.city": "व्यवसाय किस शहर में है?",
  "ask.gstin": "क्या आपके पास GSTIN है?",
  "ask.internet": "अभी काम पर आप कौन-सा इंटरनेट इस्तेमाल करते हैं?",
  "ask.tools": "इनमें से आप पहले से क्या इस्तेमाल करते हैं? जितने लागू हों, सब चुनिए।",
  "kind.shop": "दुकान या छोटी सेवा",
  "kind.office": "दफ़्तर या क्लिनिक",
  "kind.chain": "कई शाखाएँ",
  "kind.factory": "फ़ैक्ट्री या वर्कशॉप",
  "gstin.active": "हाँ, यह सक्रिय है",
  "gstin.inactive": "हाँ, पर यह रद्द या निलंबित है",
  "gstin.none": "GSTIN नहीं है",
  "internet.none": "इंटरनेट नहीं है",
  "internet.mobile_hotspot": "मोबाइल हॉटस्पॉट",
  "internet.home_broadband": "घर वाला ब्रॉडबैंड",
  "internet.business_broadband": "बिज़नेस ब्रॉडबैंड",
  "internet.leased_line": "लीज़्ड लाइन",
  "tool.pos": "बिलिंग / POS",
  "tool.email": "बिज़नेस ईमेल",
  "tool.cctv": "CCTV",
  "tool.messaging": "ग्राहकों के लिए WhatsApp या SMS",
  "tools.none": "इनमें से कुछ नहीं",
  "tools.done": "हो गया",
  "city.other": "मेरा शहर सूची में नहीं है",
  "employees.justMe": "सिर्फ़ मैं",
  "action.human": "किसी व्यक्ति से बात करें",
  "action.restart": "फिर से शुरू करें",
  ack: "नोट किया: {facts}।",
  "ack.employees": "{n} लोग",
  "ack.employees.one": "सिर्फ़ आप",
  "ack.sites": "{n} जगहें",
  "ack.sites.one": "1 जगह",
  "ack.city.unlisted": "{city} (हम वे प्रोडक्ट दिखाएँगे जो हर शहर में मिलते हैं)",
  "ack.city.unlistedNoName": "सूची से बाहर का शहर (हम वे प्रोडक्ट दिखाएँगे जो हर शहर में मिलते हैं)",
  "ack.tools.none": "अभी बिलिंग, ईमेल, CCTV या मैसेजिंग टूल नहीं",
  "ack.tools": "आप {tools} इस्तेमाल करते हैं",
  rejected: "माफ़ कीजिए, यह जवाब मैं इस्तेमाल नहीं कर सका।",
  "rejected.employees": "कृपया लोगों की संख्या 1 से 100000 के बीच पूरी संख्या में बताइए।",
  "rejected.sites": "कृपया जगहों की संख्या 1 से 1000 के बीच पूरी संख्या में बताइए।",
  unclear: "माफ़ कीजिए, मैं समझ नहीं पाया।",
  stuck: "मुझे समझने में दिक्कत हो रही है। हमारी टीम का कोई व्यक्ति मदद कर सकता है: “किसी व्यक्ति से बात करें” दबाइए, या नीचे दिया कोई विकल्प चुनिए।",
  handoff: "ज़रूर। नीचे अपना मोबाइल नंबर दीजिए, हमारी टीम का कोई व्यक्ति आपको कॉल करेगा।",
  notInterested: "कोई बात नहीं। क्या आप बता सकते हैं क्यों? इससे हमें बेहतर बनने में मदद मिलती है।",
  restarted: "ठीक है, फिर से शुरू करते हैं।",
  greetingBack: "नमस्ते!",
  "recommend.intro": "{city} में {business} ({employees}, {sites}) के लिए मेरा सुझाव है: {bundle}, {monthly}/महीना।",
  "recommend.terms": "एक बार का सेटअप {setup}, कॉन्ट्रैक्ट {contract}, {days} चालू।",
  "recommend.added": "{name} (जोड़ा गया): {because}",
  "recommend.unavailable": "अभी शामिल नहीं: {list}",
  "recommend.close": "कुछ भी बदलने के लिए “मेरा कोटेशन देखें” दबाइए, या मुझसे इसके बारे में कुछ भी पूछिए।",
  "recommend.updated": "इस बदलाव के साथ मैंने आपका बंडल अपडेट कर दिया है।",
  "recommend.business.office": "दफ़्तर",
  "recommend.business.shop": "दुकान",
  "recommend.business.chain": "व्यवसाय",
  "recommend.business.factory": "यूनिट",
  "because.pos": "आप अभी बिलिंग सॉफ़्टवेयर नहीं चलाते; इससे GST वाली बिलिंग जुड़ जाती है।",
  "because.cctv": "आपके यहाँ अभी CCTV नहीं है।",
  "because.messaging": "आप पहले से WhatsApp या SMS पर ग्राहकों से बात करते हैं; इससे यह आधिकारिक बिज़नेस चैनल बन जाता है।",
  "internet.context.none": "इससे आप ऑनलाइन हो जाएँगे।",
  "internet.context.mobile_hotspot": "यह अभी के मोबाइल हॉटस्पॉट की जगह लेता है।",
  "internet.context.home_broadband": "यह घर वाले ब्रॉडबैंड की जगह बिज़नेस कनेक्शन देता है।",
  "internet.context.business_broadband": "आपके अभी के ब्रॉडबैंड से बेहतर, बिज़नेस-ग्रेड कनेक्शन।",
  "internet.context.leased_line": "इससे आप बिज़नेस-ग्रेड कनेक्शन पर ही रहते हैं।",
  "product.price": "{price}/महीना {unit}",
  "product.setup": "+ {setup} एक बार का सेटअप",
  "product.eligible": "अच्छी ख़बर: यह आपको मिल सकता है।",
  "product.inBundle": "यह पहले से आपके बंडल में है।",
  "product.addOn": "आप इसे अपने कोटेशन में चालू कर सकते हैं।",
  "product.notInBundle": "यह आपके बंडल का हिस्सा नहीं है; हमारी टीम का कोई व्यक्ति इसे जोड़ सकता है।",
  "product.notEligible": "यह आपके व्यवसाय के लिए उपलब्ध नहीं है: {reasons}",
  "product.requirements": "यह किसे मिल सकता है: {reasons}",
  "product.anyone": "यह किसी भी व्यवसाय को मिल सकता है।",
  "product.confirmLater": "आपके व्यवसाय के बारे में थोड़ा और जानकर मैं पक्का बताऊँगा।",
  "bundle.summary": "{bundle}: {monthly}/महीना, एक बार का सेटअप {setup}, कॉन्ट्रैक्ट {contract}, {days} चालू। ये हमारे कैटलॉग की लिस्ट कीमतें हैं।",
  "bundle.notYet": "आपके व्यवसाय के बारे में थोड़ा और जानते ही मैं एक साफ़ मासिक कीमत बताऊँगा।",
  noBundle: "इन जवाबों के लिए मैं बंडल नहीं बना सका। हमारी टीम का कोई व्यक्ति मदद कर सकता है: “किसी व्यक्ति से बात करें” दबाइए।",
  "reason.CITY_TIER": "यह केवल टियर-1 (बड़े महानगर) शहरों में उपलब्ध है।",
  "reason.MIN_EMPLOYEES": "व्यवसाय में कम से कम {min} लोग काम करते हों।",
  "reason.MIN_SITES": "कम से कम {min} जगहें होनी चाहिए।",
  "reason.GSTIN_REQUIRED.none": "इसके लिए सक्रिय GSTIN ज़रूरी है।",
  "reason.GSTIN_REQUIRED.inactive": "सक्रिय GSTIN ज़रूरी है; आपका GSTIN रद्द या निलंबित है।",
  "reason.REQUIRES_ONE_OF": "यह केवल {products} के साथ काम करता है।",
  or: " या ",
  and: " और ",
  listJoin: ", ",
  "month.one": "{n} महीना",
  "month.other": "{n} महीने",
  "day.one": "लगभग {n} दिन में",
  "day.other": "लगभग {n} दिन में",
  perUnit: "{unit}",
  fullStop: "।",
};

export const TEXT: Record<Lang, Record<TextKey, string>> = { en: EN, hi: HI };

export type Vars = Record<string, string | number>;

export function tr(lang: Lang, key: TextKey, vars?: Vars): string {
  const template = TEXT[lang][key];
  return vars ? template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : template;
}

/** ₹ with Indian digit grouping, no decimals (same as the quote screen). */
export const inr = (amount: number) => `₹${Math.round(amount).toLocaleString("en-IN")}`;
export const months = (lang: Lang, n: number) => tr(lang, n === 1 ? "month.one" : "month.other", { n });
export const days = (lang: Lang, n: number) => tr(lang, n === 1 ? "day.one" : "day.other", { n });

export const kindLabel = (lang: Lang, kind: BusinessKind) => tr(lang, `kind.${kind}`);
export const gstinLabel = (lang: Lang, g: GstinStatus) => tr(lang, `gstin.${g}`);
export const internetLabel = (lang: Lang, i: InternetType) => tr(lang, `internet.${i}`);
export const toolLabel = (lang: Lang, t: Tool) => tr(lang, `tool.${t}`);

const UNITS: Record<string, { en: string; hi: string }> = {
  "per site": { en: "per location", hi: "प्रति जगह" },
  "per line": { en: "per line", hi: "प्रति लाइन" },
  "per IP": { en: "per IP", hi: "प्रति IP" },
  "per channel": { en: "per channel", hi: "प्रति चैनल" },
  "per number": { en: "per number", hi: "प्रति नंबर" },
  "per pack": { en: "per pack", hi: "प्रति पैक" },
  "per account": { en: "per account", hi: "प्रति अकाउंट" },
  "per user": { en: "per user", hi: "प्रति यूज़र" },
  "per counter": { en: "per counter", hi: "प्रति काउंटर" },
  "per device": { en: "per device", hi: "प्रति डिवाइस" },
  "per camera": { en: "per camera", hi: "प्रति कैमरा" },
  "per vehicle": { en: "per vehicle", hi: "प्रति वाहन" },
};
export const unitText = (lang: Lang, unit: string) => UNITS[unit]?.[lang] ?? unit;

/** Hindi product descriptions (same text as frontend/src/i18n/products.ts; a test keeps them equal). */
export const HI_DESCRIPTIONS: Record<ProductId, string> = {
  P01: "बिज़नेस फ़ाइबर ब्रॉडबैंड, 100 Mbps, अनलिमिटेड डेटा",
  P02: "बिज़नेस फ़ाइबर ब्रॉडबैंड, 300 Mbps, अनलिमिटेड डेटा, स्टैटिक IP का विकल्प",
  P03: "बिज़नेस फ़ाइबर ब्रॉडबैंड, 1 Gbps, प्राथमिकता सहायता",
  P04: "वायरलेस (5G) ब्रॉडबैंड, 100 Mbps, प्लग-एंड-प्ले, जहाँ फ़ाइबर नहीं है वहाँ के लिए",
  P05: "समर्पित 1:1 इंटरनेट, 20 Mbps, 99.5% SLA",
  P06: "समर्पित 1:1 इंटरनेट, 100 Mbps, 99.9% SLA",
  P07: "बिज़नेस मोबाइल लाइन, 50 GB डेटा, अनलिमिटेड कॉल",
  P08: "बिज़नेस मोबाइल लाइन, 150 GB डेटा, रोमिंग, प्राथमिकता सेवा",
  P09: "मुख्य लाइन बंद होने पर अपने-आप चालू होने वाला बैकअप राउटर, डेटा सिम के साथ",
  P10: "सभी शाखाओं की लाइनों का एक जगह से प्रबंधन, ऐप के हिसाब से प्राथमिकता",
  P11: "CCTV, सर्वर या रिमोट एक्सेस के लिए स्थायी पब्लिक IP",
  P12: "इंटरनेट पर बिज़नेस फ़ोन लाइनें, IVR और कॉल रिकॉर्डिंग के साथ",
  P13: "1800 नंबर, जो मोबाइल या क्लाउड टेलीफ़ोनी पर आता है",
  P14: "हर महीने 10,000 SMS, अलर्ट और प्रचार के लिए, DLT रजिस्ट्रेशन में मदद",
  P15: "वेरिफ़ाइड WhatsApp चैनल, कैटलॉग, हर महीने 1,000 बातचीत",
  P16: "अपने डोमेन पर बिज़नेस ईमेल, डॉक्यूमेंट और वीडियो मीटिंग",
  P17: "PC और फ़ोन का अपने-आप बैकअप, 1 TB",
  P18: "डोमेन, 5 पेज की वेबसाइट बनाने का टूल, होस्टिंग, SSL",
  P19: "GST वाली बिलिंग, स्टॉक, टैबलेट पर UPI/कार्ड से भुगतान",
  P20: "PC और फ़ोन के लिए एंटीवायरस और रैनसमवेयर सुरक्षा",
  P21: "आपकी जगह पर नेक्स्ट-जेन फ़ायरवॉल, Accel SOC द्वारा प्रबंधित",
  P22: "प्रबंधित Wi-Fi, ग्राहकों के लिए अलग Wi-Fi और कंटेंट फ़िल्टरिंग",
  P23: "HD कैमरा, 30 दिन की क्लाउड रिकॉर्डिंग, मोबाइल ऐप पर देखें",
  P24: "मशीनों के चलने और बिजली की खपत के लिए IoT सिम और सेंसर किट",
  P25: "GPS ट्रैकर, IoT सिम और लाइव डैशबोर्ड के साथ",
};

export function describeProduct(catalogue: Catalogue, lang: Lang, id: ProductId): string {
  return lang === "hi" ? (HI_DESCRIPTIONS[id] ?? catalogue.get(id).description) : catalogue.get(id).description;
}

/** Why a product helps a small business, in plain words. */
export const PRODUCT_WHY: Record<ProductId, { en: string; hi: string }> = {
  P01: { en: "Fast, reliable fibre internet for billing, UPI and everyday work.", hi: "बिलिंग, UPI और रोज़ के काम के लिए तेज़ और भरोसेमंद फ़ाइबर इंटरनेट।" },
  P02: { en: "300 Mbps fibre so the whole team can work, video-call and use cloud tools at once.", hi: "300 Mbps फ़ाइबर, ताकि पूरी टीम एक साथ काम, वीडियो कॉल और क्लाउड टूल चला सके।" },
  P03: { en: "1 Gbps fibre with priority support for heavy data use.", hi: "ज़्यादा डेटा वाले काम के लिए 1 Gbps फ़ाइबर, प्राथमिकता सहायता के साथ।" },
  P04: { en: "Plug-and-play 5G internet, ready in about 2 days, with no digging or cabling.", hi: "प्लग-एंड-प्ले 5G इंटरनेट, लगभग 2 दिन में चालू, न खुदाई न तार।" },
  P05: { en: "A dedicated internet line with a 99.5% uptime promise, so machines and billing don't stop.", hi: "समर्पित इंटरनेट लाइन, 99.5% चालू रहने का वादा, ताकि मशीनें और बिलिंग न रुकें।" },
  P06: { en: "A dedicated 100 Mbps line with a 99.9% uptime promise for larger units.", hi: "बड़ी यूनिट के लिए समर्पित 100 Mbps लाइन, 99.9% चालू रहने का वादा।" },
  P07: { en: "A business mobile line with 50 GB data and unlimited calls, on the same bill.", hi: "50 GB डेटा और अनलिमिटेड कॉल वाली बिज़नेस मोबाइल लाइन, उसी बिल में।" },
  P08: { en: "Mobile lines with 150 GB data, roaming and priority care for staff on the move.", hi: "बाहर काम करने वाले स्टाफ़ के लिए 150 GB डेटा, रोमिंग और प्राथमिकता सेवा वाली मोबाइल लाइनें।" },
  P09: { en: "If the main line goes down, a 4G/5G backup switches on by itself, so you stay online.", hi: "मुख्य लाइन बंद हो तो 4G/5G बैकअप अपने-आप चालू हो जाता है, आप ऑनलाइन रहते हैं।" },
  P10: { en: "Manage the internet of every branch from one place and keep billing apps first.", hi: "सभी शाखाओं का इंटरनेट एक जगह से संभालें और बिलिंग ऐप को प्राथमिकता दें।" },
  P11: { en: "A fixed IP so you can view CCTV or reach your server from anywhere.", hi: "स्थायी IP, ताकि आप कहीं से भी CCTV देख सकें या सर्वर तक पहुँच सकें।" },
  P12: { en: "Business phone lines over the internet, with IVR and call recording.", hi: "इंटरनेट पर बिज़नेस फ़ोन लाइनें, IVR और कॉल रिकॉर्डिंग के साथ।" },
  P13: { en: "One 1800 number customers can call free, for all your branches.", hi: "एक 1800 नंबर, जिस पर ग्राहक मुफ़्त कॉल कर सकें, सभी शाखाओं के लिए।" },
  P14: { en: "10,000 SMS a month for order alerts and offers.", hi: "ऑर्डर अलर्ट और ऑफ़र के लिए हर महीने 10,000 SMS।" },
  P15: { en: "A verified WhatsApp channel with a catalogue, so customers can order and ask on WhatsApp.", hi: "कैटलॉग वाला वेरिफ़ाइड WhatsApp चैनल, ताकि ग्राहक WhatsApp पर ऑर्डर और सवाल कर सकें।" },
  P16: { en: "Email on your own business name, plus documents and video meetings for each person.", hi: "अपने बिज़नेस नाम पर ईमेल, साथ में डॉक्यूमेंट और वीडियो मीटिंग, हर व्यक्ति के लिए।" },
  P17: { en: "Automatic 1 TB backup of PCs and phones, so your records are safe.", hi: "PC और फ़ोन का अपने-आप 1 TB बैकअप, ताकि आपके रिकॉर्ड सुरक्षित रहें।" },
  P18: { en: "A simple website on your own domain so customers can find you online.", hi: "अपने डोमेन पर आसान वेबसाइट, ताकि ग्राहक आपको ऑनलाइन ढूँढ सकें।" },
  P19: { en: "GST-ready billing and stock on a tablet, with UPI and card payments.", hi: "टैबलेट पर GST वाली बिलिंग और स्टॉक, UPI और कार्ड भुगतान के साथ।" },
  P20: { en: "Protects every PC and phone from viruses and ransomware.", hi: "हर PC और फ़ोन को वायरस और रैनसमवेयर से बचाता है।" },
  P21: { en: "A firewall that blocks attacks, managed by our security team.", hi: "हमलों को रोकने वाला फ़ायरवॉल, हमारी सुरक्षा टीम द्वारा प्रबंधित।" },
  P22: { en: "Secure Wi-Fi with a separate guest network for customers.", hi: "सुरक्षित Wi-Fi, ग्राहकों के लिए अलग गेस्ट नेटवर्क के साथ।" },
  P23: { en: "HD cameras with 30 days of cloud recording you can watch on your phone.", hi: "HD कैमरे, 30 दिन की क्लाउड रिकॉर्डिंग, जिसे आप फ़ोन पर देख सकते हैं।" },
  P24: { en: "Sensors that show machine uptime and power use, so you spot problems early.", hi: "सेंसर जो मशीनों का चलना और बिजली की खपत दिखाते हैं, ताकि दिक्कत जल्दी पकड़ में आए।" },
  P25: { en: "Live GPS tracking for your vehicles.", hi: "आपकी गाड़ियों की लाइव GPS ट्रैकिंग।" },
};

export const productWhy = (lang: Lang, id: ProductId) => PRODUCT_WHY[id]?.[lang] ?? "";

/** A catalogue rule violation as a sentence (same wording as the quote screen). */
export function reasonText(catalogue: Catalogue, lang: Lang, v: RuleViolation): string {
  const p = v.params;
  switch (v.code) {
    case "CITY_TIER":
      return tr(lang, "reason.CITY_TIER");
    case "MIN_EMPLOYEES":
      return tr(lang, "reason.MIN_EMPLOYEES", { min: Number(p.minEmployees) });
    case "MIN_SITES":
      return tr(lang, "reason.MIN_SITES", { min: Number(p.minSites) });
    case "GSTIN_REQUIRED":
      return tr(lang, p.gstin === "inactive" ? "reason.GSTIN_REQUIRED.inactive" : "reason.GSTIN_REQUIRED.none");
    case "REQUIRES_ONE_OF": {
      const ids = Array.isArray(p.requiresOneOf) ? (p.requiresOneOf as string[]) : [];
      return tr(lang, "reason.REQUIRES_ONE_OF", { products: ids.map((id) => catalogue.get(id).name).join(tr(lang, "or")) });
    }
  }
}
