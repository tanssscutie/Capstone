// app/my-reports.tsx
// Your reports: every report you filed and its outcome (opened from /reports).
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { MyReports } from '../features/reports/Reports';
import { listMyReports, type MyReportOut } from '../lib/api/business';

export default function MyReportsRoute() {
  const router = useRouter();
  const [reports, setReports] = useState<MyReportOut[] | null>(null);

  useEffect(() => {
    listMyReports().then(setReports).catch(() => setReports([]));
  }, []);

  return (
    <MyReports
      reports={reports ?? []}
      loading={reports === null}
      onBack={() => (router.canGoBack() ? router.back() : router.push('/reports'))}
    />
  );
}
