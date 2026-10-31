/** KYC document types (shared by server page and client form). */
export const KYC_DOCS = [
  { type: 'business_registration', label: 'Business registration certificate', hint: 'Commercial register extract or certificate of incorporation', required: true },
  { type: 'tax_registration', label: 'Tax registration certificate', hint: 'VAT / EIN / GSTIN / TRN document', required: true },
  { type: 'authorised_id', label: 'ID of the authorised person', hint: 'Passport or national ID — needed for larger orders', required: false },
] as const;
