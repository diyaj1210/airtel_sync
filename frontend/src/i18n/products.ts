import type { Lang } from "./I18nProvider";

/**
 * Plain-language product text. Product names are brand names and stay as in the catalogue;
 * the description and the unit are translated. English descriptions come from the catalogue.
 */
const HI_DESCRIPTIONS: Record<string, string> = {
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

export function productDescription(productId: string, englishDescription: string, lang: Lang): string {
  return lang === "hi" ? (HI_DESCRIPTIONS[productId] ?? englishDescription) : englishDescription;
}

export function unitLabel(unit: string, lang: Lang): string {
  return UNITS[unit]?.[lang] ?? unit;
}

export const TRANSLATED_PRODUCT_IDS = Object.keys(HI_DESCRIPTIONS);
export const TRANSLATED_UNITS = Object.keys(UNITS);
