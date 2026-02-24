import { useState, useEffect } from 'react';
import { getCertificationInfo } from '../services/gradingService';
import { CERTIFICATIONS } from '../constants';
import type { CertificationInfo } from '../types';

/**
 * certification_info/config 조회 (자격증별 시험명·과목·시험일 등).
 * 표시 이름은 getCertDisplayName(cert, certInfo) 사용.
 */
export function useCertificationInfo(certCode: string | null | undefined): {
  certInfo: CertificationInfo | null;
  loading: boolean;
} {
  const [certInfo, setCertInfo] = useState<CertificationInfo | null>(null);
  const [loading, setLoading] = useState(!!certCode);

  useEffect(() => {
    if (!certCode) {
      setCertInfo(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    getCertificationInfo(certCode)
      .then(setCertInfo)
      .finally(() => setLoading(false));
  }, [certCode]);

  return { certInfo, loading };
}

/** 모든 자격증의 certification_info 한 번에 조회 (사이드바·목록 등에서 표시명 통일용) */
export function useAllCertificationInfos(): {
  certInfos: Record<string, CertificationInfo | null>;
  loading: boolean;
} {
  const [certInfos, setCertInfos] = useState<Record<string, CertificationInfo | null>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const codes = CERTIFICATIONS.map((c) => c.code);
    setLoading(true);
    Promise.all(codes.map((code) => getCertificationInfo(code)))
      .then((results) => {
        const next: Record<string, CertificationInfo | null> = {};
        codes.forEach((code, i) => {
          next[code] = results[i] ?? null;
        });
        setCertInfos(next);
      })
      .finally(() => setLoading(false));
  }, []);

  return { certInfos, loading };
}
