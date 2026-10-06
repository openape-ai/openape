export interface DocumentAsset {
  name: string
  contentType: 'image/png' | 'image/jpeg' | 'image/webp'
  data: string
}

export interface ReportDocument {
  type: 'document'
  schemaVersion: 1
  title: string
  html: string
  css?: string
  language?: string
  category?: string
  seriesId?: string
  assets?: DocumentAsset[]
}

export interface DocumentReceipt {
  id: string
  slug: string
  version: number
  digest: string
  artifactDigest: string
  policyVersion: string
  url: string
  edition_url: string
  replayed?: boolean
}
