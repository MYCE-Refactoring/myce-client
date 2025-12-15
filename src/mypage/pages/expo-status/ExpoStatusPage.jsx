import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styles from './ExpoStatusPage.module.css';
import settingStyles from '../../../expo-admin/pages/setting/Setting.module.css';
import { getMyExpos } from '../../../api/service/user/memberApi';
import PaymentDetailModal from '../../components/paymentDetailModal/PaymentDetailModal';

// 한 페이지에 보여줄 항목 수
const ITEMS_PER_PAGE = 5;
// 페이지네이션 버튼 그룹에 보여줄 페이지 수
const PAGE_BTN_COUNT = 5;


const ExpoStatusPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState(1);
  const [expos, setExpos] = useState([]);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedPaymentData, setSelectedPaymentData] = useState(null);

  useEffect(() => {
    fetchMyExpos();
  }, [currentPage]);

  const fetchMyExpos = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getMyExpos(currentPage - 1, ITEMS_PER_PAGE);
      const { content, totalPages: total } = response.data;
      
      // 백엔드 데이터를 프론트엔드 형식에 맞게 변환
      const transformedExpos = content.map(expo => ({
        id: expo.expoId,
        title: expo.title,
        applyDate: new Date(expo.createdAt).toLocaleDateString('ko-KR'),
        postPeriod: formatDateRange(expo.displayStartDate, expo.displayEndDate),
        location: expo.locationDetail ? `${expo.location} (${expo.locationDetail})` : expo.location,
        status: getStatusLabel(expo.status),
        statusKey: expo.status, // 원본 상태 키 저장
        isPremium: expo.isPremium
      }));
      
      setExpos(transformedExpos);
      setTotalPages(total);
    } catch (err) {
      console.error('신청 박람회 조회 실패:', err);
      setError(t('expoStatus.loadError'));
      setExpos([]);
    } finally {
      setLoading(false);
    }
  };

  const formatDateRange = (startDate, endDate) => {
    if (!startDate || !endDate) return 'N/A';
    const start = new Date(startDate).toLocaleDateString('ko-KR');
    const end = new Date(endDate).toLocaleDateString('ko-KR');
    return `${start} ~ ${end}`;
  };

  const getStatusLabel = (status) => {
    const statusMap = {
      'PENDING_APPROVAL': t('expoStatus.status.PENDING_APPROVAL'),
      'PENDING_PAYMENT': t('expoStatus.status.PENDING_PAYMENT'),
      'PENDING_PUBLISH': t('expoStatus.status.PENDING_PUBLISH'),
      'PENDING_CANCEL': t('expoStatus.status.PENDING_CANCEL'),
      'PUBLISHED': t('expoStatus.status.PUBLISHED'),
      'PUBLISH_ENDED': t('expoStatus.status.PUBLISH_ENDED'),
      'SETTLEMENT_REQUESTED': t('expoStatus.status.SETTLEMENT_REQUESTED'),
      'COMPLETED': t('expoStatus.status.COMPLETED'),
      'REJECTED': t('expoStatus.status.REJECTED'),
      'CANCELLED': t('expoStatus.status.CANCELLED')
    };
    return statusMap[status] || status;
  };

  // 상태에 따른 CSS 클래스 매핑
  const getStatusClass = (status) => {
    const statusClassMap = {
      'PENDING_APPROVAL': styles.badgePENDING_APPROVAL,
      'PENDING_PAYMENT': styles.badgePENDING_PAYMENT,
      'PENDING_PUBLISH': styles.badgePENDING_PUBLISH,
      'PENDING_CANCEL': styles.badgePENDING_CANCEL,
      'PUBLISHED': styles.badgePUBLISHED,
      'PUBLISH_ENDED': styles.badgePUBLISH_ENDED,
      'SETTLEMENT_REQUESTED': styles.badgeSETTLEMENT_REQUESTED,
      'COMPLETED': styles.badgeCOMPLETED,
      'REJECTED': styles.badgeREJECTED,
      'CANCELLED': styles.badgeCANCELLED
    };
    return statusClassMap[status] || '';
  };

  // 결제 정보를 볼 수 있는 상태인지 확인하는 함수 (승인대기, 결제대기 제외)
  const canViewPaymentInfo = (statusKey) => {
    const excludedStatuses = [
      'PENDING_APPROVAL', // 승인대기
      'PENDING_PAYMENT'   // 결제대기 
    ];
    return !excludedStatuses.includes(statusKey);
  };

  // 결제 정보 버튼 클릭 핸들러
  const handlePaymentInfoClick = (e, expo) => {
    e.stopPropagation(); // 행 클릭 이벤트 방지
    
    // 기존 PaymentDetailModal 형식에 맞는 데이터
    const paymentData = {
      expoName: expo.title,
      applicant: '홍길동', // TODO: 실제 신청자 정보로 교체
      period: expo.postPeriod,
      totalDays: 30, // TODO: 실제 게시 일수로 교체
      dailyUsageFee: expo.isPremium ? 30000 : 20000,
      usageFeeAmount: expo.isPremium ? 900000 : 600000,
      depositAmount: expo.isPremium ? 300000 : 200000,
      totalAmount: expo.isPremium ? 1200000 : 800000,
      isPremium: expo.isPremium,
      commissionRate: 10
    };
    
    setSelectedPaymentData(paymentData);
    setShowPaymentModal(true);
  };

  const handleClosePaymentModal = () => {
    setShowPaymentModal(false);
    setSelectedPaymentData(null);
  };

  const handleRowClick = (expo) => {
    navigate(`/mypage/expo-status/${expo.id}`);
  };

  // 페이지네이션 버튼 렌더링
  const renderPaginationButtons = () => {
    if (totalPages <= 1) return null;

    const pages = [];

    // 이전 버튼
    if (currentPage > 1) {
      pages.push(
        <button key="prev" onClick={() => setCurrentPage(currentPage - 1)} className={styles.pageButton}>
          {t('expoStatus.pagination.prev')}
        </button>
      );
    }

    // 페이지 번호들 (현재 페이지 기준 ±2)
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);

    for (let i = startPage; i <= endPage; i++) {
      pages.push(
        <button
          key={i}
          onClick={() => setCurrentPage(i)}
          className={`${styles.pageButton} ${i === currentPage ? styles.activePage : ''}`}
        >
          {i}
        </button>
      );
    }

    // 다음 버튼
    if (currentPage < totalPages) {
      pages.push(
        <button key="next" onClick={() => setCurrentPage(currentPage + 1)} className={styles.pageButton}>
          {t('expoStatus.pagination.next')}
        </button>
      );
    }

    return pages;
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <h2 className={styles.title}>{t('expoStatus.title')}</h2>
        <div className={styles.loading}>{t('expoStatus.loading')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <h2 className={styles.title}>{t('expoStatus.title')}</h2>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>{t('expoStatus.title')}</h2>
      {expos.length > 0 ? (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('expoStatus.table.no')}</th>
                <th>{t('expoStatus.table.expoName')}</th>
                <th>{t('expoStatus.table.appliedAt')}</th>
                <th>{t('expoStatus.table.postPeriod')}</th>
                <th>{t('expoStatus.table.location')}</th>
                <th>{t('expoStatus.table.status')}</th>
              </tr>
            </thead>
            <tbody>
              {expos.map((expo, index) => (
                <tr key={expo.id} onClick={() => handleRowClick(expo)} className={styles.tableRow}>
                  <td>{(currentPage - 1) * ITEMS_PER_PAGE + index + 1}</td>
                  <td>
                    {expo.title}
                    {expo.isPremium && (
                      <span
                        className={styles.premiumBadge}
                        aria-label="Premium"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className={styles.premiumIcon} role="img" aria-hidden>👑</span>
                        PREMIUM
                      </span>
                    )}
                                      </td>
                  <td>{expo.applyDate}</td>
                  <td>{expo.postPeriod}</td>
                  <td>{expo.location}</td>
                  <td>
                    <span className={`${settingStyles.badge} ${settingStyles[`badge${expo.statusKey}`]} ${styles.statusBadge}`}>
                      {expo.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* 페이지네이션 버튼 영역 */}
          <div className={styles.pagination}>
            {renderPaginationButtons()}
          </div>
        </>
      ) : (
        <div className={styles.noData}>{t('expoStatus.noData')}</div>
      )}
      
      {/* 결제 상세 정보 모달 */}
      {showPaymentModal && selectedPaymentData && (
        <PaymentDetailModal
          expoName={selectedPaymentData.expoName}
          applicant={selectedPaymentData.applicant}
          period={selectedPaymentData.period}
          totalDays={selectedPaymentData.totalDays}
          dailyUsageFee={selectedPaymentData.dailyUsageFee}
          usageFeeAmount={selectedPaymentData.usageFeeAmount}
          depositAmount={selectedPaymentData.depositAmount}
          totalAmount={selectedPaymentData.totalAmount}
          isPremium={selectedPaymentData.isPremium}
          commissionRate={selectedPaymentData.commissionRate}
          onClose={handleClosePaymentModal}
        >
          {/* 결제 버튼 없이 확인 버튼만 */}
          <button 
            className={styles.confirmBtn}
            onClick={handleClosePaymentModal}
          >
            {t('expoStatus.modal.confirm')}
          </button>
        </PaymentDetailModal>
      )}
    </div>
  );
};

export default ExpoStatusPage;
