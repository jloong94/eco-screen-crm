export type Customer = {
  name: string;
  phone: string;
  address: string;
  area: string;
  appointmentDate: string;
};

export type Product = {
  id: string;
  name: string;
  price: number;
  minimumSqft: number;
};

export type QuoteStatus = "quoted" | "follow-up" | "won" | "cancelled";

export type QuoteItem = {
  id: string;
  label: string;
  productId: string;
  widthMm: number;
  heightMm: number;
  quantity: number;
};

export type Quote = {
  id: string;
  quoteNo: string;
  createdAt: string;
  updatedAt: string;
  status: QuoteStatus;
  customer: Customer;
  items: QuoteItem[];
  deposit: number;
  total: number;
  balance: number;
};

export type Order = {
  id: string;
  orderNo: string;
  quoteNo: string;
  createdAt: string;
  customer: Customer;
  items: QuoteItem[];
  total: number;
  deposit: number;
  balance: number;
  installationDate: string;
  installationNotes: string;
};
