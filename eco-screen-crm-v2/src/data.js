export const roles = ["Admin", "Secretary", "Sales", "Production", "Installer"];

export const quotationStatuses = ["Draft", "Quoted", "Follow Up", "Won", "Ordered", "Lost", "Cancelled"];

export const defaultProducts = [
  { id: "roller", name: "Roller", category: "Roller", sellingPrice: 33, costPrice: 0, calculationType: "sqft", minimumSqft: 11, active: true },
  { id: "removeable-screen", name: "Removeable Screen", category: "Window", sellingPrice: 36, costPrice: 0, calculationType: "sqft", minimumSqft: 11, active: true },
  { id: "three-section-screen", name: "3 Section Screen", category: "Window", sellingPrice: 0, costPrice: 0, calculationType: "sqft", minimumSqft: 11, active: true },
  { id: "pocket-lock-screen", name: "Pocket Lock Screen", category: "Window", sellingPrice: 50, costPrice: 0, calculationType: "sqft", minimumSqft: 11, active: true },
  { id: "roller-door", name: "Roller Door", category: "Door", sellingPrice: 41, costPrice: 0, calculationType: "sqft", minimumSqft: 21, active: true },
  { id: "sliding-screen", name: "Sliding Screen", category: "Sliding", sellingPrice: 55, costPrice: 0, calculationType: "sqft", minimumSqft: 11, active: true },
  { id: "sliding-security-window", name: "Sliding Security Window", category: "Security Mesh", sellingPrice: 90, costPrice: 0, calculationType: "sqft", minimumSqft: 11, active: true },
  { id: "sliding-door", name: "Sliding Door", category: "Sliding Door", sellingPrice: 100, costPrice: 0, calculationType: "sqft", minimumSqft: 21, active: true },
  { id: "sliding-stainless-steel-net", name: "Sliding Stainless Steel Net", category: "Sliding", sellingPrice: 55, costPrice: 0, calculationType: "sqft", minimumSqft: 21, active: true },
  { id: "magnetic-screen", name: "Magnetic Screen", category: "Magnetic", sellingPrice: 10, costPrice: 0, calculationType: "sqft", minimumSqft: 11, active: true },
  { id: "security-mesh-window", name: "Security Mesh Window", category: "Security Mesh", sellingPrice: 90, costPrice: 0, calculationType: "sqft", minimumSqft: 11, active: true },
  { id: "security-mesh-door", name: "Security Mesh Door", category: "Security Mesh", sellingPrice: 100, costPrice: 0, calculationType: "sqft", minimumSqft: 21, active: true },
  { id: "with-grill", name: "With Grill", category: "Add On", sellingPrice: 13, costPrice: 0, calculationType: "sqft", minimumSqft: 11, active: true },
  { id: "opening", name: "Opening", category: "Add On", sellingPrice: 35, costPrice: 0, calculationType: "fixed", minimumSqft: 0, active: true },
  { id: "digital-lock", name: "Digital Lock", category: "Hardware", sellingPrice: 0, costPrice: 0, calculationType: "fixed", minimumSqft: 0, active: true }
];
