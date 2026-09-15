import React, { useState } from 'react';
import { useNotifications, AppNotification } from '../contexts/NotificationContext';
import { Bell, CheckCheck, Trash2, Search, AlertCircle, Info, CheckCircle2, ShieldAlert } from 'lucide-react';
import { useLocation } from 'wouter';

export const NotificationsPage: React.FC = () => {
  const { notifications, unreadCount, loading, error, markAsRead, markAllAsRead, deleteNotification } = useNotifications();
  const [, setLocation] = useLocation();
  const [filter, setFilter] = useState<'ALL' | 'UNREAD' | 'HIGH'>('ALL');
  const [search, setSearch] = useState('');

  const filteredNotifications = notifications.filter((n) => {
    if (filter === 'UNREAD' && n.isRead) return false;
    if (filter === 'HIGH' && n.priority !== 'HIGH' && n.priority !== 'URGENT') return false;
    if (search) {
      const q = search.toLowerCase();
      return n.title.toLowerCase().includes(q) || n.message.toLowerCase().includes(q);
    }
    return true;
  });

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'URGENT':
        return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-rose-100 text-rose-700 border border-rose-200 flex items-center gap-1"><ShieldAlert className="w-3 h-3"/> URGENT</span>;
      case 'HIGH':
        return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-amber-100 text-amber-700 border border-amber-200 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> HIGH</span>;
      case 'NORMAL':
        return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-[#F3EDE4] text-[#8B6748] border border-[#C4A882] flex items-center gap-1"><Info className="w-3 h-3"/> NORMAL</span>;
      default:
        return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-slate-100 text-slate-600">LOW</span>;
    }
  };

  const handleAction = (notif: AppNotification) => {
    if (!notif.isRead) markAsRead(notif.id);
    if (notif.roomId) setLocation('/rooms');
    else if (notif.reservationId) setLocation('/reservations');
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <Bell className="w-7 h-7 text-[#8B6748]" /> Notifications Center
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Real-time updates and activity feed across all departments
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllAsRead}
            className="px-4 py-2 bg-[#8B6748] hover:bg-[#7A5A3C] text-white font-medium text-sm rounded-xl transition-all flex items-center gap-2 shadow-xs self-start sm:self-auto cursor-pointer"
          >
            <CheckCheck className="w-4 h-4" /> Mark All as Read
          </button>
        )}
      </div>

      {/* Filters & Search Bar */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0">
          <button
            onClick={() => setFilter('ALL')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              filter === 'ALL' ? 'bg-[#8B6748] text-white' : 'bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200'
            }`}
          >
            All ({notifications.length})
          </button>
          <button
            onClick={() => setFilter('UNREAD')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              filter === 'UNREAD' ? 'bg-[#8B6748] text-white' : 'bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200'
            }`}
          >
            Unread ({unreadCount})
          </button>
          <button
            onClick={() => setFilter('HIGH')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              filter === 'HIGH' ? 'bg-[#8B6748] text-white' : 'bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200'
            }`}
          >
            High Priority
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search notifications..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#8B6748]"
          />
        </div>
      </div>

      {/* Notifications List */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            Loading notifications...
          </div>
        ) : error ? (
          <div className="p-12 text-center text-rose-700 text-sm">
            <AlertCircle className="w-10 h-10 mx-auto mb-2 text-rose-300" />
            <p className="font-medium">{error}</p>
            <p className="text-xs text-rose-500 mt-1">Please try again shortly.</p>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="p-12 text-center text-slate-500 space-y-2">
            <CheckCircle2 className="w-10 h-10 mx-auto text-slate-300" />
            <p className="text-base font-medium text-slate-700">No notifications found</p>
            <p className="text-xs text-slate-400">You are all caught up!</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredNotifications.map((notif) => (
              <div
                key={notif.id}
                className={`p-4 sm:p-5 transition-all flex flex-col sm:flex-row items-start justify-between gap-4 hover:bg-slate-50 ${
                  !notif.isRead ? 'bg-[#F3EDE4]/50 border-l-4 border-l-[#8B6748]' : ''
                }`}
              >
                <div className="flex items-start gap-4 flex-1">
                  <div className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${!notif.isRead ? 'bg-[#8B6748]' : 'bg-transparent'}`} />
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900">{notif.title}</h3>
                      {getPriorityBadge(notif.priority)}
                      <span className="text-xs text-slate-400 font-mono">
                        {new Date(notif.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">{notif.message}</p>
                    
                    {(notif.roomId || notif.reservationId) && (
                      <button
                        onClick={() => handleAction(notif)}
                        className="text-xs font-semibold text-[#8B6748] hover:underline mt-2 inline-block cursor-pointer"
                      >
                        View Details →
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  {!notif.isRead && (
                    <button
                      onClick={() => markAsRead(notif.id)}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors cursor-pointer"
                    >
                      Mark Read
                    </button>
                  )}
                  <button
                    onClick={() => deleteNotification(notif.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
