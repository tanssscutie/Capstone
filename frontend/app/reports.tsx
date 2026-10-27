// app/reports.tsx
// Reports: report a business, and follow the reports you filed.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import Reports from '../features/reports/Reports';
import { listMyReports, listReportSuggestions, searchBusinesses, type MyReportOut, type ReportSuggestionOut } from '../lib/api/business';

export default function ReportsRoute() {
  const router = useRouter();
  const [reports, setReports] = useState<MyReportOut[]>([]);
  const [suggestions, setSuggestions] = useState<ReportSuggestionOut[]>([]);

  const load = useCallback(async () => {
    setReports(await listMyReports().catch(() => []));
  }, []);

  useEffect(() => {
    load();
    listReportSuggestions().then(setSuggestions).catch(() => setSuggestions([]));
  }, [load]);

  return (
    <Reports
      reports={reports}
      suggestions={suggestions}
      onSearch={searchBusinesses}
      onReported={load}
      onBack={() => (router.canGoBack() ? router.back() : router.push('/home'))}
    />
  );
}
