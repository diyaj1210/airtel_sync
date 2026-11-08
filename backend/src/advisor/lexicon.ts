import type { CityTier, ProductId } from "../catalogue/types.js";
import type { City } from "../cities.js";
import type { BusinessKind, InternetType, Tool } from "./answers.js";

/**
 * Words the no-key advisor understands, in English, Hindi (Devanagari) and Hinglish.
 * Matching rules (see `hasWord`):
 *  - Latin keywords match whole words; a trailing "*" matches any ending ("branch*").
 *  - Devanagari keywords match at the start of a word, with any ending (Hindi inflects by suffix:
 *    दुकान, दुकानें, दुकानों); a trailing "$" asks for the whole word ("चेन$" is not "चेन्नई").
 */

/** Lower-case, ASCII digits, and Hindi spelling variants folded (nukta, chandrabindu). */
export function normalise(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/़/g, "") // nukta: फ़ -> फ
    .replace(/ँ/g, "ं") // chandrabindu -> anusvara: हाँ -> हां
    .replace(/[​-‍﻿]/g, "")
    .replace(/[’`]/g, "'");
}

const DEVANAGARI = /[ऀ-ॿ]/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const reCache = new Map<string, RegExp>();

function keywordRe(keyword: string): RegExp {
  let re = reCache.get(keyword);
  if (!re) {
    const prefix = keyword.endsWith("*");
    const body = escapeRe(normalise(prefix ? keyword.slice(0, -1) : keyword)).replace(/ /g, "[\\s-]*");
    re = new RegExp(`(?<![a-z0-9])${body}${prefix ? "" : "(?![a-z0-9])"}`);
    reCache.set(keyword, re);
  }
  return re;
}

function devanagariRe(keyword: string): RegExp {
  let re = reCache.get(keyword);
  if (!re) {
    const whole = keyword.endsWith("$");
    const body = escapeRe(normalise(whole ? keyword.slice(0, -1) : keyword)).replace(/ /g, "\\s+");
    re = new RegExp(`(?<![\u0900-\u097F])${body}${whole ? "(?![\u0900-\u097F])" : ""}`, "u");
    reCache.set(keyword, re);
  }
  return re;
}

/** Does normalised `text` contain the keyword? */
export function hasWord(text: string, keyword: string): boolean {
  return (DEVANAGARI.test(keyword) ? devanagariRe(keyword) : keywordRe(keyword)).test(text);
}

export const hasAny = (text: string, keywords: readonly string[]): boolean => keywords.some((k) => hasWord(text, k));

// ---------------------------------------------------------------- cities

/** Other spellings for the 22 cities in smb_leads.csv (English names always match too). */
const CITY_ALIASES: Record<string, readonly string[]> = {
  Ahmedabad: ["ahmadabad", "amdavad", "अहमदाबाद"],
  Bengaluru: ["bangalore", "bengalore", "बेंगलुरु", "बेंगलूरु", "बैंगलोर", "बंगलौर", "बेंगलोर"],
  Chennai: ["madras", "चेन्नई", "चेन्नै", "मद्रास"],
  Delhi: ["new delhi", "dilli", "दिल्ली", "नई दिल्ली"],
  Hyderabad: ["हैदराबाद"],
  Kolkata: ["calcutta", "कोलकाता", "कलकत्ता"],
  Mumbai: ["bombay", "मुंबई", "मुम्बई", "बंबई", "बम्बई"],
  Pune: ["poona", "पुणे", "पूना"],
  Bhopal: ["भोपाल"],
  Coimbatore: ["kovai", "कोयंबटूर", "कोयम्बटूर", "कोयंबतूर"],
  Indore: ["इंदौर", "इन्दौर"],
  Jaipur: ["जयपुर"],
  Kochi: ["cochin", "कोच्चि", "कोची", "कोचीन"],
  Lucknow: ["lakhnau", "लखनऊ", "लखनउ"],
  Ludhiana: ["लुधियाना"],
  Mysuru: ["mysore", "मैसूरु", "मैसूर"],
  Nagpur: ["नागपुर"],
  Nashik: ["nasik", "नासिक", "नाशिक"],
  Patna: ["पटना"],
  Surat: ["सूरत"],
  Vadodara: ["baroda", "वडोदरा", "बड़ौदा", "बडौदा"],
  Visakhapatnam: ["vizag", "vishakhapatnam", "विशाखापत्तनम", "विशाखापट्टनम", "विजाग"],
};

/** Find one of our cities named in the text (English, other spellings or Hindi). */
export function matchCity(text: string, cities: readonly City[]): City | undefined {
  const t = normalise(text);
  return cities.find((c) => hasWord(t, c.name) || (CITY_ALIASES[c.name] ?? []).some((a) => hasWord(t, a)));
}

export const CITY_HINDI_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CITY_ALIASES).map(([name, aliases]) => [name, aliases.find((a) => DEVANAGARI.test(a)) ?? name]),
);

export const tierOf = (cities: readonly City[], name: string): CityTier | undefined => cities.find((c) => c.name === name)?.tier;

// ---------------------------------------------------------------- business type

export interface BusinessTypeEntry {
  kind: BusinessKind;
  en: string;
  hi: string;
  keywords: readonly string[];
}

/** Most specific first; the first match wins. Labels follow `business_type` in smb_leads.csv. */
export const BUSINESS_TYPES: readonly BusinessTypeEntry[] = [
  // factories and workshops
  { kind: "factory", en: "Auto-parts unit", hi: "ऑटो-पार्ट्स यूनिट", keywords: ["auto parts", "auto-parts", "autoparts", "ऑटो पार्ट्स"] },
  { kind: "factory", en: "Textile unit", hi: "टेक्सटाइल यूनिट", keywords: ["textile*", "garment factory", "टेक्सटाइल", "कपड़ा मिल", "कपड़ा फैक्ट्री"] },
  { kind: "factory", en: "Plastic moulding unit", hi: "प्लास्टिक मोल्डिंग यूनिट", keywords: ["plastic*", "moulding", "molding", "प्लास्टिक"] },
  { kind: "factory", en: "Packaging unit", hi: "पैकेजिंग यूनिट", keywords: ["packaging", "पैकेजिंग"] },
  { kind: "factory", en: "Food processing unit", hi: "फ़ूड प्रोसेसिंग यूनिट", keywords: ["food processing", "फूड प्रोसेसिंग"] },
  { kind: "factory", en: "Furniture workshop", hi: "फ़र्नीचर वर्कशॉप", keywords: ["furniture", "फर्नीचर"] },
  { kind: "factory", en: "Printing press", hi: "प्रिंटिंग प्रेस", keywords: ["printing", "प्रिंटिंग", "छापाखाना"] },
  {
    kind: "factory",
    en: "Factory",
    hi: "फ़ैक्टरी",
    keywords: ["factory", "factories", "manufactur*", "workshop*", "plant", "mill", "fabrication", "फैक्ट्री", "फैक्टरी", "कारखान", "वर्कशॉप", "उत्पादन", "मैन्युफैक्चरिंग"],
  },
  // offices and clinics
  { kind: "office", en: "Dental clinic", hi: "डेंटल क्लिनिक", keywords: ["dental", "dentist*", "डेंटल", "दांत"] },
  { kind: "office", en: "Diagnostic lab", hi: "डायग्नोस्टिक लैब", keywords: ["diagnostic*", "pathology", "lab", "labs", "लैब", "पैथोलॉजी"] },
  { kind: "office", en: "Physiotherapy clinic", hi: "फ़िज़ियोथेरेपी क्लिनिक", keywords: ["physio*", "फिजियो"] },
  { kind: "office", en: "Law office", hi: "वकील का दफ़्तर", keywords: ["law", "lawyer*", "advocate*", "legal", "वकील", "एडवोकेट"] },
  { kind: "office", en: "CA firm", hi: "CA फ़र्म", keywords: ["ca", "ca firm", "chartered", "accountant*", "सीए", "चार्टर्ड"] },
  { kind: "office", en: "Coaching centre", hi: "कोचिंग सेंटर", keywords: ["coaching", "tuition*", "classes", "institute", "कोचिंग", "ट्यूशन"] },
  { kind: "office", en: "Architecture studio", hi: "आर्किटेक्चर स्टूडियो", keywords: ["architect*", "आर्किटेक्ट"] },
  { kind: "office", en: "Travel agency", hi: "ट्रैवल एजेंसी", keywords: ["travel*", "tour*", "ट्रैवल"] },
  { kind: "office", en: "Insurance agency", hi: "बीमा एजेंसी", keywords: ["insurance", "बीमा", "इंश्योरेंस"] },
  { kind: "office", en: "Real estate agency", hi: "रियल एस्टेट एजेंसी", keywords: ["real estate", "property", "properties", "प्रॉपर्टी", "रियल एस्टेट"] },
  { kind: "office", en: "Clinic", hi: "क्लिनिक", keywords: ["clinic*", "doctor*", "hospital*", "nursing home", "क्लिनिक", "डॉक्टर", "अस्पताल", "दवाखाना"] },
  { kind: "office", en: "Office", hi: "दफ़्तर", keywords: ["office", "offices", "consult*", "agency", "firm", "ऑफिस", "दफ्तर", "कार्यालय", "एजेंसी"] },
  // shops and small services
  { kind: "shop", en: "Kirana store", hi: "किराना दुकान", keywords: ["kirana", "grocery", "general store", "किराना", "परचून"] },
  { kind: "shop", en: "Bakery", hi: "बेकरी", keywords: ["bakery", "bakeries", "baker*", "बेकरी"] },
  { kind: "shop", en: "Salon", hi: "सैलून", keywords: ["salon*", "parlour*", "parlor*", "barber*", "सैलून", "पार्लर", "नाई"] },
  { kind: "shop", en: "Pharmacy", hi: "दवा की दुकान", keywords: ["pharmacy", "pharmacies", "chemist*", "medical store*", "medical shop*", "मेडिकल", "दवा", "फार्मेसी"] },
  { kind: "shop", en: "Boutique", hi: "बुटीक", keywords: ["boutique*", "बुटीक"] },
  { kind: "shop", en: "Optician", hi: "चश्मे की दुकान", keywords: ["optic*", "spectacle*", "चश्म"] },
  { kind: "shop", en: "Sweet shop", hi: "मिठाई की दुकान", keywords: ["sweet*", "mithai", "halwai", "मिठाई", "हलवाई"] },
  { kind: "shop", en: "Hardware store", hi: "हार्डवेयर की दुकान", keywords: ["hardware", "हार्डवेयर"] },
  { kind: "shop", en: "Stationery shop", hi: "स्टेशनरी की दुकान", keywords: ["stationery", "stationary", "स्टेशनरी"] },
  { kind: "shop", en: "Mobile repair shop", hi: "मोबाइल रिपेयर की दुकान", keywords: ["mobile repair", "phone repair", "mobile shop", "मोबाइल रिपेयर", "मोबाइल की दुकान"] },
  { kind: "shop", en: "Restaurant", hi: "रेस्टोरेंट", keywords: ["restaurant*", "cafe", "cafes", "dhaba", "eatery", "रेस्टोरेंट", "रेस्तरां", "ढाबा", "कैफे"] },
  { kind: "shop", en: "Gym", hi: "जिम", keywords: ["gym", "gyms", "fitness", "जिम"] },
  { kind: "shop", en: "Hotel", hi: "होटल", keywords: ["hotel*", "lodge", "guest house", "होटल"] },
  { kind: "shop", en: "Pre-school", hi: "प्री-स्कूल", keywords: ["pre-school*", "preschool*", "play school", "प्ले स्कूल"] },
  { kind: "shop", en: "Shop", hi: "दुकान", keywords: ["shop", "shops", "store", "stores", "dukaan*", "dukan*", "retail", "outlet", "दुकान", "स्टोर", "शॉप"] },
];

/** Words that mean "several branches": the business is a chain. */
export const CHAIN_WORDS = ["chain*", "branches", "outlets", "franchise*", "चेन$", "शाखाएं", "शाखाओं", "ब्रांचें", "ब्रांचों", "आउटलेट्स"];

// ---------------------------------------------------------------- numbers

export const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, single: 1,
  ek: 1, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chheh: 6, saat: 7, aath: 8, nau: 9, das: 10,
  एक: 1, दो: 2, तीन: 3, चार: 4, पांच: 5, छह: 6, "छः": 6, छे: 6, सात: 7, आठ: 8, नौ: 9, दस: 10,
  ग्यारह: 11, बारह: 12, पंद्रह: 15, बीस: 20,
};

/** A token right after a number that says what is counted. */
export const EMPLOYEE_UNITS = ["people", "person", "persons", "employee*", "staff*", "worker*", "member*", "emp", "log", "logo", "logon", "लोग", "कर्मचारी", "स्टाफ", "आदमी", "व्यक्ति", "मेंबर"];
export const SITE_UNITS = [
  "location*", "branch*", "site*", "shop*", "store*", "outlet*", "unit*", "office*", "clinic*", "factor*", "centre*", "center*", "godown*", "warehouse*", "restaurant*", "hotel*", "plant*",
  "dukaan*", "dukan*", "shakha*", "शाखा", "ब्रांच", "जगह", "दुकान", "आउटलेट", "यूनिट", "स्टोर", "ऑफिस", "क्लिनिक", "फैक्ट्री", "फैक्टरी", "गोदाम", "सेंटर",
];

// ---------------------------------------------------------------- yes / no

export const GST_WORDS = ["gst", "gstin", "जीएसटी", "जी एस टी"];
export const INACTIVE_WORDS = ["cancel*", "suspend*", "expired", "inactive", "lapsed", "रद्द", "निलंबित", "कैंसल", "सस्पेंड", "बंद हो"];
export const NO_WORDS = ["no", "not", "don't", "dont", "do not", "nahi", "nahin", "nai", "none", "nothing", "without", "never", "नहीं", "नही", "कोई नहीं", "कुछ नहीं"];
export const YES_WORDS = ["yes", "yeah", "yep", "haan", "han", "ha", "ji", "active", "registered", "have", "हां", "जी हां", "है$", "हैं$", "चालू", "सक्रिय", "रजिस्टर्ड"];

// ---------------------------------------------------------------- current internet and tools

export const INTERNET_WORDS: readonly [InternetType, readonly string[]][] = [
  ["leased_line", ["leased*", "dedicated line", "लीज्ड", "लीज़्ड", "लीज लाइन"]],
  ["mobile_hotspot", ["hotspot*", "hot spot", "mobile data", "phone data", "phone internet", "mobile internet", "dongle", "data card", "हॉटस्पॉट", "मोबाइल डेटा", "मोबाइल डाटा", "मोबाइल इंटरनेट", "फोन से", "मोबाइल से"]],
  ["home_broadband", ["home broadband", "home wifi", "home wi-fi", "home connection", "home internet", "घर का", "घरेलू"]],
  ["business_broadband", ["broadband", "fibre", "fiber", "wifi", "wi-fi", "ftth", "ब्रॉडबैंड", "ब्राडबैंड", "फाइबर", "वाईफाई", "वाई-फाई"]],
];
export const NO_INTERNET_WORDS = ["no internet", "without internet", "इंटरनेट नहीं", "नेट नहीं"];
export const INTERNET_WORD = ["internet", "net", "इंटरनेट", "नेट"];

export const TOOL_WORDS: readonly [Tool, readonly string[]][] = [
  ["pos", ["pos", "billing", "bill software", "billing software", "tally", "vyapar", "बिलिंग", "बिल मशीन", "पीओएस"]],
  ["email", ["email*", "e-mail*", "gmail", "outlook", "mail", "ईमेल", "मेल", "जीमेल"]],
  ["cctv", ["cctv", "camera*", "cam", "सीसीटीवी", "कैमरा", "कैमरे"]],
  ["messaging", ["whatsapp", "sms", "messages", "messaging", "व्हाट्सएप", "व्हाट्सऐप", "वॉट्सऐप", "एसएमएस", "मैसेज"]],
];

/** Words that say the owner is describing what they use today (not asking about a product). */
export const USAGE_WORDS = ["use", "uses", "using", "used", "currently", "today", "right now", "abhi", "we have", "i have", "chalate", "अभी", "इस्तेमाल", "चलाते", "लगा है", "लगे हैं", "है हमारे पास", "हमारे पास"];

// ---------------------------------------------------------------- intents

export const HUMAN_WORDS = [
  "human", "agent", "real person", "a person", "executive", "salesman", "sales person", "someone from", "call me", "call back", "callback", "talk to someone", "speak to someone", "customer care",
  "insaan", "kisi se baat", "इंसान", "किसी से बात", "कॉल करें", "कॉल करो", "फोन करें", "फोन करो", "एजेंट", "व्यक्ति से बात", "आदमी से बात",
];
export const NOT_INTERESTED_WORDS = ["not interested", "no thanks", "no thank you", "not now", "nahi chahiye", "नहीं चाहिए", "रुचि नहीं", "जरूरत नहीं", "ज़रूरत नहीं", "अभी नहीं"];
export const GREETING_WORDS = ["hi", "hii", "hello", "hey", "namaste", "namaskar", "good morning", "good evening", "नमस्ते", "नमस्कार", "हेलो", "हैलो", "प्रणाम"];
export const QUESTION_WORDS = [
  "what", "which", "how", "why", "can", "could", "do you", "does", "is there", "is it", "should", "tell me", "explain",
  "kya", "kaise", "kitna", "kitne", "kyu", "kyun", "kab", "क्या", "कैसे", "कितना", "कितने", "कितनी", "क्यों", "कब", "बताइए", "बताओ", "बताएं", "मिलेगा", "मिलेगी", "मिल सकता", "मिल सकती",
];
export const BUNDLE_QUESTION_WORDS = [
  "how much", "price*", "cost*", "rate", "charge*", "fee", "fees", "bill", "total", "monthly", "per month", "setup", "installation", "install", "contract", "lock-in", "how long", "when", "why", "bundle", "plan", "cheaper", "discount",
  "kitna", "kab", "kyun", "कीमत", "दाम", "कितना", "कितने", "खर्च", "महीना", "सेटअप", "इंस्टॉल", "कॉन्ट्रैक्ट", "कब", "क्यों", "बंडल", "प्लान", "सस्ता",
];
export const RESTART_WORDS = ["start over", "restart", "start again", "reset", "फिर से शुरू", "दोबारा शुरू"];

/** Words that point to catalogue products (most specific first). Exact product names also match. */
export const PRODUCT_WORDS: readonly [readonly ProductId[], readonly string[]][] = [
  [["P10"], ["sd-wan", "sdwan", "sd wan", "एसडी-वैन", "एसडी वैन"]],
  [["P11"], ["static ip", "fixed ip", "public ip", "स्टैटिक आईपी", "स्टैटिक ip"]],
  [["P05", "P06"], ["leased line*", "leased*", "लीज्ड लाइन", "लीज लाइन"]],
  [["P09"], ["failover", "backup internet", "backup router", "backup line", "बैकअप इंटरनेट", "बैकअप राउटर"]],
  [["P17"], ["cloud backup", "data backup", "backup", "क्लाउड बैकअप", "बैकअप"]],
  [["P12"], ["cloud telephony", "telephony", "ivr", "sip", "call recording", "phone lines", "टेलीफोनी", "आईवीआर"]],
  [["P13"], ["toll free", "toll-free", "1800", "टोल फ्री", "टोल-फ्री"]],
  [["P15"], ["whatsapp business", "whatsapp api", "whatsapp", "व्हाट्सएप", "व्हाट्सऐप"]],
  [["P14"], ["sms", "bulk sms", "एसएमएस"]],
  [["P16"], ["email*", "e-mail*", "office suite", "ईमेल"]],
  [["P18"], ["website*", "domain*", "वेबसाइट", "डोमेन"]],
  [["P19"], ["pos", "billing", "बिलिंग"]],
  [["P20"], ["antivirus", "anti-virus", "endpoint", "ransomware", "virus", "एंटीवायरस", "वायरस"]],
  [["P21"], ["firewall*", "फायरवॉल", "फायरवाल"]],
  [["P22"], ["wifi", "wi-fi", "guest wifi", "वाईफाई", "वाई-फाई"]],
  [["P23"], ["cctv", "camera*", "सीसीटीवी", "कैमरा"]],
  [["P24"], ["machine monitoring", "iot", "sensor*", "मशीन मॉनिटरिंग", "सेंसर"]],
  [["P25"], ["fleet*", "gps", "vehicle tracking", "tracker", "जीपीएस", "गाड़ी ट्रैक"]],
  [["P04"], ["5g", "airfiber", "air fiber", "air fibre", "wireless broadband", "5जी", "एयरफाइबर"]],
  [["P01", "P02", "P03"], ["fibre", "fiber", "broadband", "फाइबर", "ब्रॉडबैंड"]],
  [["P07", "P08"], ["postpaid", "mobile plan*", "sim", "sim card", "mobile line*", "पोस्टपेड", "सिम", "मोबाइल प्लान"]],
];
