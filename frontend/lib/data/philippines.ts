// lib/data/philippines.ts
// Reference lists for validating free-text location fields (Post a Requirement's
// delivery city, Onboarding's city/province) — not an authoritative gazetteer, just
// enough to catch an obviously mistyped or nonexistent entry. Shared here (moved out
// of features/post-requirement) once Onboarding needed the same city list too.

// The ~149 officially chartered cities of the Philippines (highly urbanized,
// independent component, and component cities), sourced from PhilAtlas. This is
// not the ~1,500-entry municipality list — too numerous to maintain here — so a
// legitimate municipality not on this list will still read as "unrecognized."
export const PH_CITIES = [
  'Angeles', 'Bacolod', 'Baguio', 'Butuan', 'Cagayan de Oro', 'Caloocan', 'Cebu',
  'Davao', 'General Santos', 'Iligan', 'Iloilo', 'Lapu-Lapu', 'Las Piñas', 'Lucena',
  'Makati', 'Malabon', 'Mandaluyong', 'Mandaue', 'Manila', 'Marikina', 'Muntinlupa',
  'Navotas', 'Olongapo', 'Parañaque', 'Pasay', 'Pasig', 'Puerto Princesa',
  'Quezon City', 'San Juan', 'Tacloban', 'Taguig', 'Valenzuela', 'Zamboanga',
  'Cotabato', 'Dagupan', 'Naga', 'Ormoc', 'Santiago',
  'Alaminos', 'Antipolo', 'Bacoor', 'Bago', 'Bais', 'Balanga', 'Batac', 'Batangas',
  'Bayawan', 'Baybay', 'Bayugan', 'Bislig', 'Biñan', 'Bogo', 'Borongan', 'Cabadbaran',
  'Cabanatuan', 'Cabuyao', 'Cadiz', 'Calamba', 'Calapan', 'Calbayog', 'Candon',
  'Canlaon', 'Carcar', 'Catbalogan', 'Cauayan', 'Cavite City', 'Danao', 'Dapitan',
  'Dasmariñas', 'Digos', 'Dipolog', 'Dumaguete', 'El Salvador', 'Escalante', 'Gapan',
  'General Trias', 'Gingoog', 'Guihulngan', 'Himamaylan', 'Ilagan', 'Iriga',
  'Isabela', 'Kabankalan', 'Kidapawan', 'Koronadal', 'La Carlota', 'Lamitan',
  'Laoag', 'Legazpi', 'Ligao', 'Lipa', 'Maasin', 'Mabalacat', 'Malaybalay',
  'Malolos', 'Marawi', 'Masbate', 'Mati', 'Meycauayan', 'Muñoz', 'Oroquieta',
  'Ozamiz', 'Pagadian', 'Palayan', 'Panabo', 'Passi', 'Roxas', 'Sagay', 'Samal',
  'San Carlos', 'San Fernando', 'San Jose', 'San Jose del Monte', 'San Pablo',
  'San Pedro', 'Santa Rosa', 'Santo Tomas', 'Silay', 'Sipalay', 'Sorsogon',
  'Surigao', 'Tabaco', 'Tabuk', 'Tacurong', 'Tagaytay', 'Tagbilaran', 'Tagum',
  'Talisay', 'Tanauan', 'Tandag', 'Tangub', 'Tanjay', 'Tarlac City', 'Tayabas',
  'Toledo', 'Trece Martires', 'Tuguegarao', 'Urdaneta', 'Valencia', 'Victorias',
  'Vigan',
];

// The 82 provinces of the Philippines, plus Metro Manila / NCR — which isn't
// officially a province, but is what nearly everyone (including this app's own
// sample data) writes in a "province" field for anywhere in the capital region.
export const PH_PROVINCES = [
  'Ilocos Norte', 'Ilocos Sur', 'La Union', 'Pangasinan',
  'Batanes', 'Cagayan', 'Isabela', 'Nueva Vizcaya', 'Quirino',
  'Aurora', 'Bataan', 'Bulacan', 'Nueva Ecija', 'Pampanga', 'Tarlac', 'Zambales',
  'Batangas', 'Cavite', 'Laguna', 'Quezon', 'Rizal',
  'Marinduque', 'Occidental Mindoro', 'Oriental Mindoro', 'Palawan', 'Romblon',
  'Albay', 'Camarines Norte', 'Camarines Sur', 'Catanduanes', 'Masbate', 'Sorsogon',
  'Aklan', 'Antique', 'Capiz', 'Guimaras', 'Iloilo', 'Negros Occidental',
  'Bohol', 'Cebu', 'Negros Oriental', 'Siquijor',
  'Biliran', 'Eastern Samar', 'Leyte', 'Northern Samar', 'Samar', 'Southern Leyte',
  'Zamboanga del Norte', 'Zamboanga del Sur', 'Zamboanga Sibugay',
  'Bukidnon', 'Camiguin', 'Lanao del Norte', 'Misamis Occidental', 'Misamis Oriental',
  'Davao de Oro', 'Davao del Norte', 'Davao del Sur', 'Davao Occidental', 'Davao Oriental',
  'Cotabato', 'Sarangani', 'South Cotabato', 'Sultan Kudarat',
  'Agusan del Norte', 'Agusan del Sur', 'Dinagat Islands', 'Surigao del Norte', 'Surigao del Sur',
  'Basilan', 'Lanao del Sur', 'Maguindanao del Norte', 'Maguindanao del Sur', 'Sulu', 'Tawi-Tawi',
  'Abra', 'Apayao', 'Benguet', 'Ifugao', 'Kalinga', 'Mountain Province',
  'Metro Manila', 'NCR',
];

function normalizePlaceName(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/ñ/g, 'n')
    .replace(/^city of /, '')
    .replace(/ city$/, '')
    .replace(/\s+/g, ' ');
}

const PH_CITY_SET = new Set(PH_CITIES.map(normalizePlaceName));
const PH_PROVINCE_SET = new Set(PH_PROVINCES.map(normalizePlaceName));

export function isRecognizedCity(input: string): boolean {
  const normalized = normalizePlaceName(input);
  return normalized.length > 0 && PH_CITY_SET.has(normalized);
}

export function isRecognizedProvince(input: string): boolean {
  const normalized = normalizePlaceName(input);
  return normalized.length > 0 && PH_PROVINCE_SET.has(normalized);
}
