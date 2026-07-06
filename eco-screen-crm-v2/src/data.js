export const roles = ["Boss", "Admin", "Secretary", "Sales", "Production", "Installer"];

export const defaultUsers = [
  { userId: "boss-1", name: "Boss 1", username: "boss1", pin: "1234", role: "Boss", active: true },
  { userId: "boss-2", name: "Boss 2", username: "boss2", pin: "1234", role: "Boss", active: true },
  { userId: "admin-1", name: "Admin", username: "admin", pin: "1234", role: "Admin", active: true },
  { userId: "secretary-1", name: "Secretary", username: "secretary", pin: "1234", role: "Secretary", active: true },
  { userId: "sales-1", name: "Sales", username: "sales", pin: "1234", role: "Sales", active: true },
  { userId: "production-1", name: "Production", username: "production", pin: "1234", role: "Production", active: true },
  { userId: "installer-1", name: "Installer", username: "installer", pin: "1234", role: "Installer", active: true }
];

export const defaultCompanySettings = {
  id: "company",
  companyName: "Eco Screen Sdn Bhd",
  companyAddress: "24 Jalan Iks Bukit Tengah, Taman Iks Bukit Tengah, 14000 BM",
  companyPhone: "0195763499",
  companyEmail: "",
  bankName: "PUBLIC BANK",
  bankAccountName: "ECO SCREEN SDN BHD",
  bankAccountNumber: "3242952413",
  updatedAt: ""
};

export const quotationStatuses = ["quoted", "follow_up", "won", "lost"];

export const defaultProducts = [
  { id: "roller", name: "Roller", category: "Roller", sellingPrice: 33, costPrice: 0, calculationType: "sqft", minimumSqft: 11, active: true },
  { id: "removeable-screen", name: "Removeable Screen", category: "Window", sellingPrice: 36, costPrice: 0, calculationType: "sqft", minimumSqft: 11, active: true },
  { id: "three-section-screen", name: "3 Section Screen", category: "Window", sellingPrice: 0, costPrice: 0, calculationType: "sqft", minimumSqft: 11, active: true },
  { id: "pocket-lock-screen", name: "Pocket Lock Screen", category: "Window", sellingPrice: 50, costPrice: 0, calculationType: "sqft", minimumSqft: 11, active: true },
  { id: "roller-door", name: "Roller Door", category: "Door", sellingPrice: 41, costPrice: 0, calculationType: "sqft", minimumSqft: 21, active: true },
  { id: "sliding-screen", name: "Sliding Stainless Steel Net Window", category: "Sliding", sellingPrice: 55, costPrice: 0, calculationType: "sqft", minimumSqft: 11, active: true },
  { id: "sliding-security-window", name: "Sliding Security Window", category: "Security Mesh", sellingPrice: 90, costPrice: 0, calculationType: "sqft", minimumSqft: 11, active: true },
  { id: "sliding-door", name: "Sliding Security Mesh Door", category: "Sliding Door", sellingPrice: 100, costPrice: 0, calculationType: "sqft", minimumSqft: 21, active: true },
  { id: "sliding-stainless-steel-net", name: "Sliding Stainless Steel Net", category: "Sliding", sellingPrice: 55, costPrice: 0, calculationType: "sqft", minimumSqft: 21, active: true },
  { id: "magnetic-screen", name: "Magnetic Screen", category: "Magnetic", sellingPrice: 10, costPrice: 0, calculationType: "sqft", minimumSqft: 11, active: true },
  { id: "security-mesh-window", name: "Hinged Security Mesh Window", category: "Security Mesh", sellingPrice: 90, costPrice: 0, calculationType: "sqft", minimumSqft: 11, active: true },
  { id: "security-mesh-door", name: "Hinged Security Mesh Door", category: "Security Mesh", sellingPrice: 100, costPrice: 0, calculationType: "sqft", minimumSqft: 21, active: true },
  { id: "fold-security-mesh", name: "Fold Security Mesh", category: "Security Mesh", sellingPrice: 129, costPrice: 0, calculationType: "sqft", minimumSqft: 0, active: true },
  { id: "glass-with-security-mesh", name: "Glass with Security Mesh", category: "Security Mesh / Glass", sellingPrice: 190, costPrice: 0, calculationType: "sqft", minimumSqft: 0, active: true },
  { id: "hollow-1x1", name: "Hollow 1x1", category: "Hollow", sellingPrice: 5, ratePerSqft: 5, costPrice: 0, calculationType: "sqft", minimumSqft: 0, active: true },
  { id: "hollow-1x2", name: "Hollow 1x2", category: "Hollow", sellingPrice: 10, ratePerSqft: 10, costPrice: 0, calculationType: "sqft", minimumSqft: 0, active: true },
  { id: "hollow-1x3", name: "Hollow 1x3", category: "Hollow", sellingPrice: 15, ratePerSqft: 15, costPrice: 0, calculationType: "sqft", minimumSqft: 0, active: true },
  { id: "hollow-2x2", name: "Hollow 2x2", category: "Hollow", sellingPrice: 20, ratePerSqft: 20, costPrice: 0, calculationType: "sqft", minimumSqft: 0, active: true },
  { id: "hollow-2x3", name: "Hollow 2x3", category: "Hollow", sellingPrice: 25, ratePerSqft: 25, costPrice: 0, calculationType: "sqft", minimumSqft: 0, active: true },
  { id: "with-grill", name: "With Grill", category: "Add On", sellingPrice: 13, costPrice: 0, calculationType: "sqft", minimumSqft: 11, active: true },
  { id: "opening", name: "Opening", category: "Add On", sellingPrice: 35, costPrice: 0, calculationType: "fixed", minimumSqft: 0, active: true },
  { id: "digital-lock", name: "Digital Lock", category: "Hardware", sellingPrice: 0, costPrice: 0, calculationType: "fixed", minimumSqft: 0, active: true }
];
