import { useEffect, useRef, useState } from 'react';
import { uuid } from 'expo';
import { useMemberAuth } from './memberAuth';
import { MemberRequestError } from './memberSession';
import { useApiUrl } from './serverConnection';
import { purchaseProduct, readPurchaseProducts, type PurchaseProduct } from './purchases';

/** 현재 화면·회원에 속한 상품 조회와 구매 상태입니다. */
export function useWorkProducts(workId?: string) {
  const apiUrl = useApiUrl();
  const { client, state: auth } = useMemberAuth();
  const [revision, setRevision] = useState(0);
  const owner = [apiUrl, auth.generation, auth.status, auth.member?.id, workId].join(':');
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const active = useRef(true);
  const lock = useRef<string | null>(null);
  const [state, setState] = useState<{ owner: string; revision: number; products: PurchaseProduct[] | null; error: string | null } | null>(null);
  const [notice, setNotice] = useState<{ owner: string; message: string; busy: boolean } | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!workId || !['authenticated', 'anonymous'].includes(auth.status)) return;
    const controller = new AbortController();
    readPurchaseProducts(apiUrl, client, workId, controller.signal)
      .then(products => { if (!controller.signal.aborted) setState({ owner, revision, products, error: null }); })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setState({ owner, revision, products: null, error: failure instanceof Error ? failure.message : '상품 정보를 불러오지 못했습니다.' });
      });
    return () => controller.abort();
  }, [apiUrl, client, owner, revision, workId, auth.status]);

  const refresh = () => setRevision(value => value + 1);
  async function purchase(product: PurchaseProduct): Promise<void> {
    if (lock.current === owner) return;
    lock.current = owner;
    setNotice({ owner, busy: true, message: '구매를 확인하고 있습니다.' });
    const stillCurrent = () => active.current && currentOwner.current === owner && client.getSnapshot().generation === auth.generation;
    try {
      await purchaseProduct(client, product, uuid.v4);
      if (!stillCurrent()) return;
      setNotice({ owner, busy: false, message: '구매가 완료되었습니다.' });
      refresh();
    } catch (failure) {
      if (!stillCurrent()) return;
      const message = failure instanceof MemberRequestError
        ? failure.status === 401 ? '로그인이 필요합니다.'
          : failure.code === 'PRICE_CHANGED' ? '가격이 변경되었습니다. 가격을 확인한 뒤 다시 구매해 주세요.'
            : failure.code === 'ALREADY_OWNED' ? '이미 소장 중입니다.'
              : failure.status === 409 ? '구매 상태가 변경되었습니다. 다시 확인해 주세요.'
                : '구매하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        : '구매 결과를 확인하지 못했습니다. 다시 구매를 눌러 확인해 주세요.';
      setNotice({ owner, busy: false, message });
      if (failure instanceof MemberRequestError && [404, 409].includes(failure.status)) refresh();
    } finally { if (lock.current === owner) lock.current = null; }
  }
  const visible = state?.owner === owner && state.revision === revision ? state : null;
  return { products: visible?.products ?? null, loading: !!workId && visible === null,
    error: auth.status === 'error' ? auth.error : visible?.error ?? null,
    message: notice?.owner === owner ? notice.message : null, busy: notice?.owner === owner && notice.busy,
    purchase, refresh };
}
