import { useEffect, useRef } from "react";

export const useMessagesRef = (messages) => {
  const messagesRef = useRef(messages || []);

  useEffect(() => {
    messagesRef.current = messages || [];
  }, [messages]);

  return messagesRef;
};
