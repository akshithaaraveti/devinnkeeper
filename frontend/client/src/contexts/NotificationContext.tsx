import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthContext } from './AuthContext';
import { apiClient } from '../lib/api';
import { toast } from 'sonner';

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  message: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  targetRoles?: string[];
  targetUserId?: number;
  isRead: boolean;
  readAt?: string;
  createdAt: string;
  reservationId?: number;
  roomId?: number;
  metadata?: any;
}

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  loading: boolean;
  isConnected: boolean;
  fetchNotifications: (page?: number, limit?: number) => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  markAsRead: (id: number) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (id: number) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuthContext();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  const fetchUnreadCount = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiClient.notifications.getUnreadCount();
      setUnreadCount(res.data.count || 0);
    } catch (e) {
      console.error('Failed to fetch unread count:', e);
    }
  }, [user]);

  const fetchNotifications = useCallback(async (page = 1, limit = 20) => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await apiClient.notifications.list({ page, limit });
      const items = res.data?.items || res.data?.notifications || (Array.isArray(res.data) ? res.data : []);
      setNotifications(items);
      const unread = items.filter((n: AppNotification) => !n.isRead && !n.readAt).length;
      if (unreadCount === 0 && unread > 0) {
        setUnreadCount(unread);
      }
    } catch (e) {
      console.error('Failed to fetch notifications:', e);
    } finally {
      setLoading(false);
    }
  }, [user, unreadCount]);

  const playNotificationSound = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
      // Audio context error
    }
  };

  const handleNewNotification = useCallback((notif: AppNotification) => {
    playNotificationSound();
    
    if (notif.priority === 'URGENT' || notif.priority === 'HIGH') {
      toast.error(notif.title, { description: notif.message, duration: 6000 });
    } else {
      toast.info(notif.title, { description: notif.message, duration: 4000 });
    }

    setNotifications(prev => {
      if (prev.some(n => n.id === notif.id)) return prev;
      return [notif, ...prev];
    });
    setUnreadCount(prev => prev + 1);
  }, []);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      setIsConnected(false);
      return;
    }

    fetchUnreadCount();
    fetchNotifications();

    // 10-second heartbeat to guarantee synchronized notification state
    const interval = setInterval(() => {
      fetchUnreadCount();
      fetchNotifications();
    }, 10000);

    const token = localStorage.getItem('innkeeper_token') || sessionStorage.getItem('innkeeper_session_token');
    const wsUrl = window.location.origin;

    const socket: Socket = io(wsUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    socket.on('connect', () => {
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('notification:new', (data: AppNotification) => {
      handleNewNotification(data);
    });

    socket.on('approval:update', () => {
      fetchNotifications();
      fetchUnreadCount();
    });

    return () => {
      clearInterval(interval);
      socket.disconnect();
    };
  }, [user, fetchUnreadCount, fetchNotifications, handleNewNotification]);

  const markAsRead = async (id: number) => {
    try {
      await apiClient.notifications.markOneRead(id);
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n))
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (e) {
      console.error('Failed to mark notification read:', e);
    }
  };

  const markAllAsRead = async () => {
    try {
      await apiClient.notifications.markAllRead();
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true, readAt: new Date().toISOString() })));
      setUnreadCount(0);
      toast.success('All notifications marked as read');
    } catch (e) {
      console.error('Failed to mark all as read:', e);
    }
  };

  const deleteNotification = async (id: number) => {
    try {
      await apiClient.notifications.deleteOne(id);
      setNotifications(prev => {
        const target = prev.find(n => n.id === id);
        if (target && !target.isRead) {
          setUnreadCount(c => Math.max(0, c - 1));
        }
        return prev.filter(n => n.id !== id);
      });
      toast.success('Notification removed');
    } catch (e) {
      console.error('Failed to delete notification:', e);
    }
  };

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        isConnected,
        fetchNotifications,
        fetchUnreadCount,
        markAsRead,
        markAllAsRead,
        deleteNotification,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
