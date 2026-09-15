import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, CheckCheck, Trash2, ExternalLink, X, Calendar, Wrench, DollarSign, Sparkles, ShieldAlert } from 'lucide-react';
import { useNotifications, AppNotification } from '../contexts/NotificationContext';
import { useLocation } from 'wouter';

export const NotificationBell: React.FC = () => {
  const { notifications, unreadCount, markAsRead, markAllAsRead, deleteNotification, isConnected, fetchNotifications } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });
  const [, setLocation] = useLocation();
  const bellRef = useRef<HTMLDivElement>(null);
  const iconMap: Record<string, typeof Bell> = {
    NEW_RESERVATION: Calendar,
    RESERVATION_UPDATED: Calendar,
    RESERVATION_CANCELLED: Calendar,
    IDENTITY_VERIFIED: ShieldAlert,
    DIGITAL_KEY_GENERATED: ShieldAlert,
    PAYMENT_RECEIVED: DollarSign,
    MAINTENANCE_CREATED: Wrench,
    MAINTENANCE_UPDATED: Wrench,
    HOUSEKEEPING_TASK_CREATED: Sparkles,
    HOUSEKEEPING_TASK_UPDATED: Sparkles,
  };

  const formatRelativeTime = (value?: string) => {
    if (!value) return 'Just now';
    const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const toggleDropdown = () => {
    if (!isOpen) {
      fetchNotifications();
      // Calculate position based on button position in viewport
      if (bellRef.current) {
        const rect = bellRef.current.getBoundingClientRect();
        setDropdownPos({
          top: rect.bottom + 8,
          right: window.innerWidth - rect.right,
        });
      }
    }
    setIsOpen(prev => !prev);
  };

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        // Check if the click was inside the dropdown portal
        const portal = document.getElementById('notification-dropdown-portal');
        if (portal && portal.contains(e.target as Node)) return;
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleNotificationClick = (notif: AppNotification) => {
    if (!notif.isRead) {
      markAsRead(notif.id);
    }
    if (notif.roomId) {
      setLocation(`/rooms`);
    } else if (notif.reservationId) {
      setLocation(`/reservations`);
    }
    setIsOpen(false);
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'URGENT':
        return <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-100 text-rose-700 border border-rose-200">URGENT</span>;
      case 'HIGH':
        return <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-100 text-amber-700 border border-amber-200">HIGH</span>;
      default:
        return null;
    }
  };

  // Portal dropdown — rendered directly into document.body, outside all stacking contexts
  const dropdown = isOpen ? createPortal(
    <div
      id="notification-dropdown-portal"
      style={{
        position: 'fixed',
        top: dropdownPos.top,
        right: dropdownPos.right,
        width: '384px',
        maxWidth: '90vw',
        maxHeight: '80vh',
        zIndex: 2147483647, // Maximum possible z-index
      }}
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-slate-900 dark:text-white text-sm">Notifications</h3>
          {unreadCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#F3EDE4] text-[#8B6748] border border-[#C4A882] font-semibold">
              {unreadCount} new
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="text-xs text-[#8B6748] hover:text-[#7A5A3C] font-medium flex items-center gap-1 transition-colors cursor-pointer"
            >
              <CheckCheck className="w-3.5 h-3.5" /> Mark all read
            </button>
          )}
          <button onClick={() => setIsOpen(false)} className="p-1 rounded-lg text-slate-400 hover:text-[#8B6748] hover:bg-[#F3EDE4]" aria-label="Close notifications">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 flex-1">
        {notifications.length === 0 ? (
          <div className="p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
            No notifications yet
          </div>
        ) : (
          notifications.slice(0, 10).map((notif) => (
            <div
              key={notif.id}
              onClick={() => handleNotificationClick(notif)}
              className={`p-3.5 transition-colors cursor-pointer flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 group ${
                !notif.isRead ? 'bg-[#F3EDE4]/60' : ''
              }`}
            >
              <div className={`mt-1.5 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${!notif.isRead ? 'bg-[#F3EDE4] text-[#8B6748]' : 'bg-slate-100 text-slate-400'}`}>
                {(() => { const Icon = iconMap[notif.type] || Bell; return <Icon className="w-4 h-4" />; })()}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                    {notif.title}
                  </span>
                  {getPriorityBadge(notif.priority)}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
                  {notif.message}
                </p>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 block font-mono">
                  {formatRelativeTime(notif.createdAt)}
                </span>
              </div>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {!notif.isRead && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      markAsRead(notif.id);
                    }}
                    className="p-1 text-slate-400 hover:text-[#8B6748]"
                    title="Mark as read"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteNotification(notif.id);
                  }}
                  className="p-1 text-slate-400 hover:text-rose-600"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="p-2.5 border-t border-slate-100 dark:border-slate-800 text-center bg-slate-50 dark:bg-slate-900">
        <button
          onClick={() => {
            setLocation('/notifications');
            setIsOpen(false);
          }}
          className="text-xs font-semibold text-[#8B6748] hover:text-[#7A5A3C] flex items-center justify-center gap-1 w-full py-1 cursor-pointer"
        >
          View all notifications <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className="relative" ref={bellRef}>
      {/* Bell Button */}
      <button
        onClick={toggleDropdown}
        className="relative p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors focus:outline-none cursor-pointer border border-slate-200/80 bg-card/80 shadow-2xs"
        title={isConnected ? "Real-time connected" : "Notifications"}
      >
        <Bell className="w-4.5 h-4.5 text-slate-700 dark:text-slate-200" />
        
        {/* Status Indicator */}
        <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />

        {/* Unread Counter Badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-4.5 px-1 text-[10px] font-bold text-white bg-[#8B6748] rounded-full border-2 border-white dark:border-slate-900">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown rendered via Portal into document.body */}
      {dropdown}
    </div>
  );
};
