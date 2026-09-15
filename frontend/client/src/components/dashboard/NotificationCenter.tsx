import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bell, CheckCheck, Calendar, Wrench, DollarSign, Sparkles, X, Check } from "lucide-react";
import { useStore } from "@/lib/store";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface NotificationCenterProps {
  onClose: () => void;
}

const typeIcons: Record<string, typeof Bell> = {
  arrival: Calendar,
  departure: Calendar,
  maintenance: Wrench,
  charge: DollarSign,
  payment: DollarSign,
  housekeeping: Sparkles,
  system: Bell,
  ai_insight: Sparkles,
};

const typeColors: Record<string, string> = {
  arrival: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  departure: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  maintenance: "bg-red-500/10 text-red-600 dark:text-red-400",
  charge: "bg-[#F3EDE4] text-[#8B6748]",
  payment: "bg-[#F3EDE4] text-[#8B6748]",
  housekeeping: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  system: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
  ai_insight: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
};

export default function NotificationCenter({ onClose }: NotificationCenterProps) {
  const { t } = useTranslation();
  const { notifications, setNotifications, unreadCount, setUnreadCount } = useStore();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const refreshNotifications = async () => {
    try {
      const resp = await apiClient.notifications.list();
      const items = resp?.data?.items ?? resp?.data ?? [];
      setNotifications(items);
      setUnreadCount(items.filter((n: any) => !n.isRead).length);
    } catch (e) {
      console.warn("Failed to refresh notifications", e);
    }
  };

  useEffect(() => {
    refreshNotifications();
    const interval = setInterval(refreshNotifications, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleMarkRead = async (notificationId: number) => {
    try {
      await apiClient.notifications.markRead(String(notificationId));
      setNotifications(
        notifications.map((n) => (n.id === notificationId ? { ...n, isRead: true } : n))
      );
      setUnreadCount(Math.max(0, unreadCount - 1));
    } catch {
      toast.error("Unable to mark notification as read");
    }
  };

  const handleMarkAllRead = async () => {
    setIsSubmitting(true);
    try {
      await apiClient.notifications.markAllRead();
      setNotifications(notifications.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
      toast.success("All notifications marked as read");
    } catch {
      toast.error("Unable to mark all notifications as read");
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatTime = (date?: string | Date) => {
    if (!date) return t("notifications.justNow");
    const now = new Date();
    const d = new Date(date);
    const diff = now.getTime() - d.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    if (minutes < 1) return t("notifications.justNow");
    if (minutes < 60) return t("notifications.minutesAgo", { count: minutes });
    if (hours < 24) return t("notifications.hoursAgo", { count: hours });
    return d.toLocaleDateString();
  };

  const translateTitle = (title: string) => {
    if (!title) return "";
    const keyMap: Record<string, string> = {
      "Guest Checked Out": "notifications.guestCheckedOut",
      "New Booking Created": "notifications.newBookingCreated",
      "Daily Report Available": "notifications.dailyReportAvailable",
      "Room Ready": "notifications.roomReady",
      "Maintenance Alert": "notifications.maintenanceAlert",
      "Payment Received": "notifications.paymentReceived",
      "New Arrival Today": "notifications.newArrivalToday",
      "Housekeeping Alert": "notifications.housekeepingAlert",
      "Room Ready Status": "notifications.roomReadyStatus",
    };
    return keyMap[title] ? t(keyMap[title]) : title;
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="overflow-hidden border-slate-200/80 bg-white/90 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Bell className="h-4 w-4 text-[#8B6748]" />
              {t("notifications.title")}
              {unreadCount > 0 && (
                <Badge variant="destructive" className="text-xs ml-1">
                  {t("notifications.newCount", { count: unreadCount })}
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={handleMarkAllRead}
                  disabled={isSubmitting}
                >
                  <CheckCheck className="h-3.5 w-3.5 mr-1" />
                  {t("notifications.markAllRead")}
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-62.5">
            {notifications.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t("notifications.noNotifications")}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {notifications.map((notif, i) => {
                  const Icon = typeIcons[notif.type] || Bell;
                  const colorClass = typeColors[notif.type] || typeColors.system;
                  const isRead = Boolean(notif.isRead);
                  return (
                    <motion.div
                      key={notif.id || i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03 }}
                      onClick={() => !isRead && handleMarkRead(notif.id)}
                      className={`flex items-start gap-3 p-3 rounded-lg transition-colors cursor-pointer ${
                        isRead ? "opacity-60 bg-slate-50/50" : "bg-accent/40 hover:bg-accent/60"
                      }`}
                    >
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}>
                        {isRead ? <Check className="h-4 w-4 opacity-50" /> : <Icon className="h-4 w-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900">{translateTitle(notif.title)}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {notif.message}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {formatTime(notif.createdAt)}
                        </p>
                      </div>
                      {!isRead && (
                        <div className="h-2 w-2 rounded-full bg-[#8B6748] shrink-0 mt-1" />
                      )}
                    </motion.div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </motion.div>
  );
}
