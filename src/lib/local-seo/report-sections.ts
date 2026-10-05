// Report section keys. Pure, shared by the client editor and the server.
export const REPORT_SECTIONS = ['rankings', 'trends', 'competitors', 'reviews', 'performance', 'audit'] as const
export type ReportSection = (typeof REPORT_SECTIONS)[number]
