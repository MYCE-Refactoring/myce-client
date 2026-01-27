import React from "react";
import styles from "./ChatContainer.module.css";
import SharedChatArea from "../../../components/shared/chat/SharedChatArea";
import SharedChatRoomList from "../../../components/shared/chat/SharedChatRoomList";
import { useUserChatController } from "../../../features/chat/controllers/useUserChatController";

export default function ChatContainer() {
  const {
    chatRooms,
    loading,
    selectedRoom,
    newMessage,
    wsConnected,
    unreadCounts,
    currentUserId,
    error,
    messages,
    loadingMessages,
    loadingOlder,
    hasMore,
    messageError,
    messagesContainerRef,
    messagesEndRef,
    handleScroll,
    scrollToBottom,
    handleSendMessage,
    handleRoomSelect,
    setNewMessage,
    isInitialLoad,
    getCurrentButtonState,
    getRoomStateDescription,
    getButtonAction,
    getButtonText,
    handlePlatformButtonClick,
    getRoomTitle,
    getRoomAvatar,
    getRoomPriority,
    getRoomBadges,
    getRoomClassName,
    getRoomTitleClassName,
    isNearBottom,
    isPlatformRoom,
  } = useUserChatController();

  const renderChatHeader = () => {
    if (!selectedRoom) return null;

    const roomTitle = isPlatformRoom(selectedRoom)
      ? "플랫폼 상담"
      : selectedRoom.expoTitle || "박람회명 없음";

    return (
      <div
        className={styles.chatHeader}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 12px",
          borderBottom: "1px solid #e0e0e0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span>{roomTitle}</span>
          {isPlatformRoom(selectedRoom) && (
            <span
              style={{
                fontSize: "12px",
                padding: "2px 6px",
                borderRadius: "8px",
                backgroundColor:
                  getCurrentButtonState(selectedRoom.roomCode) === "ADMIN_ACTIVE"
                    ? "#4CAF50"
                    : getCurrentButtonState(selectedRoom.roomCode) ===
                      "WAITING_FOR_ADMIN"
                    ? "#ff9800"
                    : "#2196F3",
                color: "white",
              }}
            >
              {getRoomStateDescription(
                getCurrentButtonState(selectedRoom.roomCode)
              )}
            </span>
          )}
        </div>
        {isPlatformRoom(selectedRoom) && (
          <button
            onClick={() =>
              handlePlatformButtonClick(
                selectedRoom.roomCode,
                getButtonAction(getCurrentButtonState(selectedRoom.roomCode))
              )
            }
            disabled={!wsConnected}
            style={{
              backgroundColor:
                getCurrentButtonState(selectedRoom.roomCode) ===
                "WAITING_FOR_ADMIN"
                  ? "#ff9800"
                  : "#2196F3",
              color: "white",
              border: "none",
              borderRadius: "4px",
              padding: "6px 12px",
              fontSize: "12px",
              cursor: wsConnected ? "pointer" : "not-allowed",
              opacity: wsConnected ? 1 : 0.5,
            }}
          >
            {getButtonText(getCurrentButtonState(selectedRoom.roomCode))}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className={styles.chatWrapper}>
      <aside className={styles.chatList}>
        <SharedChatRoomList
          chatRooms={chatRooms}
          selectedRoom={selectedRoom}
          loading={loading}
          error={error}
          unreadCounts={unreadCounts}
          onRoomSelect={handleRoomSelect}
          onRefresh={() => window.location.reload()}
          title="상담 채팅"
          emptyMessage="아직 채팅방이 없습니다"
          getRoomTitle={getRoomTitle}
          getRoomAvatar={getRoomAvatar}
          getRoomPriority={getRoomPriority}
          getRoomBadges={getRoomBadges}
          getRoomClassName={getRoomClassName}
          getRoomTitleClassName={getRoomTitleClassName}
          headerContent={
            <div
              style={{
                fontSize: "12px",
                color: wsConnected ? "#4CAF50" : "#f44336",
              }}
            >
              {wsConnected ? "🟢 연결됨" : "🔴 연결 안됨"}
            </div>
          }
        />
      </aside>

      <main className={styles.chatArea}>
        <SharedChatArea
          messages={messages}
          loading={loadingMessages}
          loadingOlder={loadingOlder}
          hasMore={hasMore}
          isInitialLoad={isInitialLoad}
          error={messageError}
          currentUserId={currentUserId}
          currentUserType="USER"
          selectedRoom={selectedRoom}
          newMessage={newMessage}
          onMessageChange={setNewMessage}
          onSendMessage={handleSendMessage}
          placeholder="메세지를 입력해주세요"
          messagesContainerRef={messagesContainerRef}
          messagesEndRef={messagesEndRef}
          onScroll={handleScroll}
          onScrollToBottom={scrollToBottom}
          headerContent={selectedRoom ? renderChatHeader() : null}
          isConnected={wsConnected}
          isNearBottom={isNearBottom}
        />
      </main>
    </div>
  );
}
