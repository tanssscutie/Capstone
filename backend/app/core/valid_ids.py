"""Philippine government IDs accepted for the identity check (onboarding:
a valid ID + a selfie holding it). Primary IDs issued by national agencies;
school, company and barangay IDs, clearances and photocopies are not
accepted. Served to the form through GET /meta/valid-ids."""

VALID_IDS = [
    {"code": "PHILSYS", "name": "PhilSys National ID (PhilID or ePhilID)"},
    {"code": "PASSPORT", "name": "Philippine Passport"},
    {"code": "DRIVERS_LICENSE", "name": "LTO Driver's License"},
    {"code": "UMID", "name": "UMID"},
    {"code": "SSS", "name": "SSS ID"},
    {"code": "GSIS", "name": "GSIS eCard"},
    {"code": "PRC", "name": "PRC Professional ID"},
    {"code": "POSTAL", "name": "PhilPost Postal ID (improved)"},
    {"code": "VOTERS", "name": "COMELEC Voter's ID"},
    {"code": "PHILHEALTH", "name": "PhilHealth ID"},
    {"code": "TIN", "name": "BIR TIN ID"},
    {"code": "SENIOR", "name": "Senior Citizen ID"},
    {"code": "PWD", "name": "PWD ID"},
    {"code": "OFW", "name": "OFW ID (iDOLE)"},
    {"code": "IBP", "name": "IBP ID (lawyers)"},
    {"code": "SEAMAN", "name": "Seaman's Book (MARINA)"},
]
NOT_ACCEPTED = "School or company IDs, barangay IDs or certificates, NBI or police clearances, and photocopies"
VALID_ID_NAMES = {i["code"]: i["name"] for i in VALID_IDS}
