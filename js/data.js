// Subject data: [name, code, hue, saturation, accent saturation, accent lightness]
export const subjects = [
  ["Mathematics", "4MA1", 215, "45%", "85%", "64%"],
  ["Physics", "4PH1", 270, "40%", "80%", "70%"],
  ["Chemistry", "4CH1", 27, "50%", "90%", "60%"],
  ["Biology", "4BI1", 150, "40%", "65%", "58%"],
  ["English Language", "4EA1", 48, "45%", "95%", "56%"],
  ["English Literature", "4ET1", 175, "40%", "70%", "55%"],
  ["Computer Science", "4CP0", 0, "0%", "0%", "72%"],
  ["Economics", "4EC1", 335, "42%", "80%", "66%"],
  ["Business", "4BS1", 85, "40%", "65%", "55%"],
  ["Geography", "4GE1", 32, "28%", "45%", "58%"],
  ["History", "4HI1", 352, "45%", "75%", "62%"]
];

export const split = ["Mathematics", "Physics", "Chemistry", "Biology"];

export function nm(n) { return n === "Mathematics" ? "Mathematics A" : n; }

export function findSubject(name) {
  return subjects.find(function (s) { return s[0] === name; }) || null;
}

// PDF links. Key format: Subject|Track|Unit|(Tier|)Year|(Regional|)Session|type
export const pdfs = {
  /* Mathematics A Modular Specimen Papers */
  "Mathematics|Modular|U1|Foundation|specimen|qp": "maths-modular-u1-foundation-specimen-qp.pdf",
  "Mathematics|Modular|U1|Higher|specimen|qp": "maths-modular-u1-higher-specimen-qp.pdf",

  /* Physics Modular Specimen Papers */
  "Physics|Modular|U1|specimen|qp": "physics-modular-u1-specimen-qp.pdf#page=9",
  "Physics|Modular|U2|specimen|qp": "physics-modular-u2-specimen-qp.pdf",

  /* Chemistry Modular Specimen Papers */
  "Chemistry|Modular|U1|specimen|qp": "chemistry-modular-u1-specimen-qp.pdf",
  "Chemistry|Modular|U2|specimen|qp": "chemistry-modular-u2-specimen-qp.pdf",

  /* Chemistry Modular 2025 Papers (Standard & Regional) */
  "Chemistry|Modular|U1|2025|May/June|qp": "chemistry-modular-u1-2025-qp.pdf",
  "Chemistry|Modular|U1|2025|Regional|May/June|qp": "chemistry-modular-u1regional-2025-qp.pdf",
  "Chemistry|Modular|U2|2025|May/June|qp": "chemistry-modular-u2-2025-qp.pdf",
  "Chemistry|Modular|U2|2025|Regional|May/June|qp": "chemistry-modular-u2regional-2025-qp.pdf",
  /* Chemistry Modular 2025 Mark Schemes (Standard & Regional) */
  "Chemistry|Modular|U1|2025|May/June|ms": "chemistry-modular-u1-2025-ms.pdf#page=4",
  "Chemistry|Modular|U1|2025|Regional|May/June|ms": "chemistry-modular-u1regional-2025-ms.pdf#page=4",
  "Chemistry|Modular|U2|2025|May/June|ms": "chemistry-modular-u2-2025-ms.pdf#page=4",
  "Chemistry|Modular|U2|2025|Regional|May/June|ms": "chemistry-modular-u2regional-2025-ms.pdf#page=4",

  /* Biology Modular Specimen Papers */
  "Biology|Modular|U1|specimen|qp": "biology-modular-u1-specimen-qp.pdf",
  "Biology|Modular|U2|specimen|qp": "biology-modular-u2-specimen-qp.pdf"
};

export const tracks = {
  "Mathematics": { Modular: "4XMAF, 4XMAH", Linear: "4MA1" },
  "Physics": { Modular: "4XPH1", Linear: "4PH1" },
  "Chemistry": { Modular: "4XCH1", Linear: "4CH1" },
  "Biology": { Modular: "4XBI1", Linear: "4BI1" }
};

// Starter topics used for tutor suggestions and quiz topic chips.
export const topics = {
  "Mathematics": ["Quadratic equations", "Simultaneous equations", "Circle theorems", "Trigonometry (SOH CAH TOA)", "Vectors", "Differentiation", "Probability trees", "Surds and indices"],
  "Physics": ["Kinematics and motion graphs", "Forces and Newton's laws", "Electricity and circuits", "Waves and the EM spectrum", "Energy resources", "Radioactivity", "Magnetism and electromagnetism", "Density and pressure"],
  "Chemistry": ["Atomic structure", "Ionic and covalent bonding", "Moles and calculations", "Electrolysis", "Acids, bases and salts", "Rates of reaction", "Organic chemistry: alkanes and alkenes", "The periodic table"],
  "Biology": ["Photosynthesis", "Enzymes", "Respiration", "Cell structure", "Inheritance and genetics", "The circulatory system", "Ecology and food chains", "Transport in plants"],
  "English Language": ["Language analysis techniques", "Writing to persuade", "Comparing non-fiction texts", "Structure and narrative voice", "Descriptive writing"],
  "English Literature": ["Poetry anthology comparison", "Unseen poetry", "Character analysis", "Themes and context", "Writing about structure"],
  "Computer Science": ["Binary and hexadecimal", "Algorithms and pseudocode", "Searching and sorting", "Logic gates", "Networks and protocols", "Data representation"],
  "Economics": ["Supply and demand", "Price elasticity", "Market failure", "Inflation", "Exchange rates", "Fiscal and monetary policy"],
  "Business": ["Business objectives", "Marketing mix", "Break-even analysis", "Cash flow", "Motivation theories", "Stakeholders"],
  "Geography": ["River landscapes", "Coastal processes", "Urbanisation", "Fragile environments", "Hazardous environments", "Development indicators"],
  "History": ["Germany 1918–45", "The Cold War", "Russia 1905–24", "Causes of the First World War", "Civil rights in the USA"]
};

export const generalTopics = ["How to revise effectively", "Command words: describe vs explain", "Making a revision timetable", "Exam technique for 6-mark questions"];
