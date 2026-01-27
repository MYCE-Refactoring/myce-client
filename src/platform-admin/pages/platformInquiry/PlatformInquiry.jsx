import SharedChatArea from "../../../components/shared/chat/SharedChatArea";
import SharedChatRoomList from "../../../components/shared/chat/SharedChatRoomList";
import ToastFail from "../../../common/components/toastFail/ToastFail";
import styles from "./PlatformInquiry.module.css";
import { ROOM_STATES } from "../../../features/chat/utils/roomStates";
import { usePlatformAdminChatController } from "../../../features/chat/controllers/usePlatformAdminChatController";

function PlatformInquiry() {
  const {
    chatRooms,
    selectedRoom,
    newMessage,
    loading,
    error,
    isConnected,
    unreadCounts,
    currentUserId,
    requestingRooms,
    showFailToast,
    failMessage,
    messages,
    loadingMessages,
    hasMore,
    messageError,
    messagesContainerRef,
    messagesEndRef,
    handleScroll,
    scrollToBottom,
    isInitialLoad,
    setNewMessage,
    setShowFailToast,
    loadChatRooms,
    determineRoomState,
    handleRoomSelect,
    handleSendMessage,
    handleProactiveIntervention,
    handleTakeOver,
    hasAdminPermission,
    getRoomPriority,
    filterPlatformRooms,
    getRoomTitle,
    getRoomAvatar,
  } = usePlatformAdminChatController();

  const renderRoomStateBadge = (room) => {
    const state = room.currentState;
    const badgeClass = {
      [ROOM_STATES.AI_ACTIVE]: styles.badgeAiActive,
      [ROOM_STATES.WAITING_FOR_ADMIN]: styles.badgeWaiting,
      [ROOM_STATES.ADMIN_ACTIVE]: styles.badgeAdminActive,
    }[state] || styles.badgeDefault;

    const badgeText = {
      [ROOM_STATES.AI_ACTIVE]: "🤖 AI 상담",
      [ROOM_STATES.WAITING_FOR_ADMIN]: "⏳ 상담원 대기",
      [ROOM_STATES.ADMIN_ACTIVE]: "👨‍💼 상담원 활성",
    }[state] || "❓ 알 수 없음";

    return <span className={`${styles.stateBadge} ${badgeClass}`}>{badgeText}</span>;
  };

  const renderChatHeader = () => (
    <div className={styles.chatHeaderContent}>
      <div className={styles.chatInfo}>
        <span className={styles.chatTitle}>
          {selectedRoom.otherMemberName || `사용자 ${selectedRoom.roomCode.split("-")[1]}`}님과의 AI 상담
        </span>
        {renderRoomStateBadge(selectedRoom)}
      </div>

      {selectedRoom.needsAttention && (
        <button
          className={styles.takeOverButton}
          onClick={handleTakeOver}
          disabled={!isConnected || (selectedRoom.hasAssignedAdmin && !hasAdminPermission(selectedRoom))}
          title={
            selectedRoom.hasAssignedAdmin && !hasAdminPermission(selectedRoom)
              ? `다른 관리자(${selectedRoom.adminDisplayName || "관리자"})가 담당 중`
              : "상담 인계받기"
          }
        >
          ✋ 상담 인계받기
        </button>
      )}
    </div>
  );

  const getRoomBadges = (room) => {
    const badges = [];
    if (room.needsAttention) {
      badges.push(
        <span key="attention" className={styles.attentionBadge}>
          🚨
        </span>
      );
    }
    return badges;
  };

  const getRoomClassName = (room) => {
    if (room.needsAttention || requestingRooms.has(room.roomCode)) {
      return styles.glowingRoom;
    }
    return "";
  };

  return (
    <div className={styles.platformInquiry}>
      <div className={styles.header}>
        <h1>플랫폼 상담 모니터링</h1>
        <div className={styles.connectionStatus}>
          <span
            className={`${styles.statusDot} ${
              isConnected ? styles.connected : styles.disconnected
            }`}
          />
          {isConnected ? "실시간 연결됨" : "연결 끊김"}
        </div>
      </div>

      <div className={styles.chatContainer}>
        <aside className={styles.sidebar}>
          <SharedChatRoomList
            chatRooms={chatRooms}
            selectedRoom={selectedRoom}
            loading={loading}
            error={error}
            unreadCounts={unreadCounts}
            onRoomSelect={handleRoomSelect}
            onRefresh={loadChatRooms}
            title="상담 목록"
            emptyMessage="현재 진행 중인 AI 상담이 없습니다"
            getRoomPriority={getRoomPriority}
            getRoomBadges={getRoomBadges}
            getRoomClassName={getRoomClassName}
            filterRooms={filterPlatformRooms}
            getRoomTitle={getRoomTitle}
            getRoomAvatar={getRoomAvatar}
          />
        </aside>

        <main className={styles.chatMain}>
          {selectedRoom && requestingRooms.has(selectedRoom.roomCode) && (
            <div className={styles.handoffBanner}>
              <div className={styles.handoffContent}>
                <div className={styles.handoffIcon}>🔔</div>
                <div className={styles.handoffText}>
                  <strong>상담 인계 요청</strong>
                  <p>사용자가 상담원 연결을 요청했습니다. 클릭하여 상담을 인계받으세요.</p>
                </div>
                <button
                  className={styles.acceptHandoffButton}
                  onClick={handleTakeOver}
                  disabled={
                    !isConnected ||
                    (selectedRoom.hasAssignedAdmin && !hasAdminPermission(selectedRoom))
                  }
                  title={
                    selectedRoom.hasAssignedAdmin && !hasAdminPermission(selectedRoom)
                      ? `다른 관리자(${selectedRoom.adminDisplayName || "관리자"})가 이미 담당 중`
                      : "상담 인계받기"
                  }
                >
                  ✋ 상담 인계받기
                </button>
              </div>
            </div>
          )}

          {selectedRoom && determineRoomState(selectedRoom) === ROOM_STATES.ADMIN_ACTIVE && (
            <div className={styles.adminActiveBanner}>
              <div className={styles.adminActiveContent}>
                <div className={styles.adminActiveIcon}>
                  <img
                    src="https://fonts.gstatic.com/s/e/notoemoji/latest/1f464/emoji.svg"
                    alt="관리자"
                    style={{ width: "24px", height: "24px" }}
                  />
                </div>
                <div className={styles.adminActiveText}>
                  <strong>관리자 상담 진행 중</strong>
                  <p>
                    {selectedRoom.adminDisplayName || "박람회 관리자 (PLATFORM_ADMIN)"} (상담원)이 직접 상담을 진행하고 있습니다.
                  </p>
                </div>
              </div>
            </div>
          )}

          {selectedRoom && !requestingRooms.has(selectedRoom.roomCode) && (() => {
            const currentState = determineRoomState(selectedRoom);
            console.log("🎯 Banner state check:", {
              roomCode: selectedRoom.roomCode,
              currentState,
              hasAssignedAdmin: selectedRoom.hasAssignedAdmin,
              isWaitingForAdmin: selectedRoom.isWaitingForAdmin,
              roomCurrentState: selectedRoom.currentState,
              shouldShowBanner: currentState === ROOM_STATES.AI_ACTIVE,
            });
            return currentState === ROOM_STATES.AI_ACTIVE;
          })() && (
            <div className={styles.interventionBanner}>
              <div className={styles.interventionContent}>
                <div className={styles.interventionIcon}>
                  <img
                    src="https://www.gstatic.com/android/keyboard/emojikitchen/20201001/u1f916/u1f916_u1f42d.png"
                    alt="찍찍봇"
                    style={{ width: "24px", height: "24px" }}
                  />
                </div>
                <div className={styles.interventionText}>
                  <strong>AI 상담 진행 중</strong>
                  <p>필요시 관리자가 직접 개입하여 상담을 진행할 수 있습니다.</p>
                </div>
                <button
                  className={styles.interventionButton}
                  onClick={handleProactiveIntervention}
                  disabled={
                    !isConnected ||
                    (selectedRoom.hasAssignedAdmin && !hasAdminPermission(selectedRoom))
                  }
                  title={
                    selectedRoom.hasAssignedAdmin && !hasAdminPermission(selectedRoom)
                      ? `다른 관리자(${selectedRoom.adminDisplayName || "관리자"})가 이미 담당 중`
                      : "상담에 개입하기"
                  }
                >
                  🚀 개입하기
                </button>
              </div>
            </div>
          )}

          <SharedChatArea
            messages={messages}
            loading={loadingMessages}
            hasMore={hasMore}
            isInitialLoad={isInitialLoad}
            error={messageError}
            currentUserId={currentUserId}
            currentUserType="PLATFORM_ADMIN"
            alignBySenderType
            showUnreadForAllMessages
            selectedRoom={selectedRoom}
            newMessage={newMessage}
            onMessageChange={setNewMessage}
            onSendMessage={handleSendMessage}
            placeholder={
              selectedRoom && selectedRoom.hasAssignedAdmin && !hasAdminPermission(selectedRoom)
                ? `이 상담은 다른 관리자(${selectedRoom.adminDisplayName || "관리자"})가 담당하고 있습니다`
                : "관리자 메시지를 입력해주세요"
            }
            messagesContainerRef={messagesContainerRef}
            messagesEndRef={messagesEndRef}
            onScroll={handleScroll}
            onScrollToBottom={scrollToBottom}
            headerContent={selectedRoom ? renderChatHeader() : null}
            isConnected={isConnected}
            inputDisabled={
              selectedRoom && selectedRoom.hasAssignedAdmin && !hasAdminPermission(selectedRoom)
            }
          />
        </main>
      </div>

      {showFailToast && (
        <ToastFail message={failMessage} onClose={() => setShowFailToast(false)} />
      )}
    </div>
  );
}

export default PlatformInquiry;
