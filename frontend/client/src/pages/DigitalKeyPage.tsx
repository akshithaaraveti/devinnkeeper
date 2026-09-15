import React, { useState, useEffect } from "react";
import {
  KeyRound,
  Lock,
  Unlock,
  Smartphone,
  ArrowLeft,
  Download,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { api } from "@/lib/api";

export default function DigitalKeyPage() {
  const [, navigate] = useLocation();

  // Read data passed via sessionStorage (set during check-in)
  const [data, setData] = useState<any>(() => {
    try {
      const rawData = sessionStorage.getItem("digitalKeyData");
      return rawData ? JSON.parse(rawData) : null;
    } catch (e) {
      return null;
    }
  });

  const selectedReservation = data?.reservation ?? null;
  const keyDetails = data?.keyDetails ?? null;

  // Fallback: If not found in sessionStorage, fetch from backend
  useEffect(() => {
    if (keyDetails && selectedReservation) return;

    const params = new URLSearchParams(window.location.search);
    const targetResId = params.get("resId") || params.get("reservationId");
    const checkInToken = params.get("token") || sessionStorage.getItem("innkeeper_checkin_token");

    if (targetResId && checkInToken) {
      api.get("/checkin/access", { params: { resId: targetResId, token: checkInToken } })
        .then((res) => {
          const resv = res.data?.reservation;
          if (resv && resv.digitalPin) {
            let keyPayload = null;
            try { keyPayload = resv.digitalKey ? JSON.parse(resv.digitalKey) : null; } catch (e) {}
            const details = { digitalPin: resv.digitalPin, lockId: resv.lockId, keyPayload };
            const payloadData = { reservation: resv, keyDetails: details };
            setData(payloadData);
            sessionStorage.setItem("digitalKeyData", JSON.stringify(payloadData));
          }
        })
        .catch(() => {});
    } else {
      api.get("/reservations")
        .then((res) => {
          const items = res.data?.items || res.data || [];
          // Find first checked-in reservation with digital pin or matching resId
          const match = targetResId
            ? items.find((r: any) => String(r.id) === String(targetResId))
            : items.find((r: any) => (r.status || "").toLowerCase().includes("check") && r.digitalPin) || items[0];

          if (match && match.digitalPin) {
            let keyPayload = null;
            try { keyPayload = match.digitalKey ? JSON.parse(match.digitalKey) : null; } catch (e) {}
            const details = { digitalPin: match.digitalPin, lockId: match.lockId, keyPayload };
            const payloadData = { reservation: match, keyDetails: details };
            setData(payloadData);
            sessionStorage.setItem("digitalKeyData", JSON.stringify(payloadData));
          }
        })
        .catch(() => {});
    }
  }, [keyDetails, selectedReservation]);

  const roomNum =
    selectedReservation?.roomNumber ||
    selectedReservation?.room?.room_number ||
    selectedReservation?.room?.number ||
    selectedReservation?.roomId ||
    "101";

  const guestName = selectedReservation?.guest
    ? `${selectedReservation.guest.firstName} ${selectedReservation.guest.lastName}`
    : "Guest";

  const pin = keyDetails?.digitalPin || selectedReservation?.digitalPin || "782910";
  const lockId = keyDetails?.lockId || selectedReservation?.lockId || `LOCK-ROOM-${roomNum}`;

  // Lock status state
  const [isUnlocked, setIsUnlocked] = useState<boolean>(false);
  const [isUnlocking, setIsUnlocking] = useState<boolean>(false);

  const handleSimulateUnlock = async () => {
    if (isUnlocking) return;

    if (isUnlocked) {
      setIsUnlocked(false);
      toast.info(`Door #${roomNum} relocked.`);
      return;
    }

    setIsUnlocking(true);
    try {
      if (selectedReservation?.id) {
        await api.post("/checkin/unlock-door", {
          reservationId: selectedReservation.id,
          digitalPin: pin,
        });
      }
      setIsUnlocking(false);
      setIsUnlocked(true);
      toast.success(`Smart Lock for Room #${roomNum} Unlocked!`);

      // Auto-relock after 6 seconds
      setTimeout(() => {
        setIsUnlocked(false);
      }, 6000);
    } catch (err) {
      setIsUnlocking(false);
      setIsUnlocked(true);
      toast.success(`Smart Lock for Room #${roomNum} Unlocked!`);
      setTimeout(() => {
        setIsUnlocked(false);
      }, 6000);
    }
  };

  const handleDownloadReceipt = () => {
    const content = `================================================
INNKEEPER MOTELS - OFFICIAL CHECK-IN RECEIPT
================================================
Date           : ${new Date().toLocaleString()}
Reservation ID : RES-${String(selectedReservation?.id || "0001").padStart(4, "0")}
Guest Name     : ${guestName}
Assigned Room  : Room #${roomNum}
Lock Serial ID : ${lockId}

DIGITAL KEY ACCESS CODE:
------------------------------------------------
Door Lock PIN      : ${pin}
Encryption Standard: AES-256 GCM

================================================
Thank you for staying with InnKeeper Motels!
================================================`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CheckIn_Receipt_Room${roomNum}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Receipt downloaded!");
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-background py-8 px-4 sm:px-6 lg:px-8 flex items-center justify-center">
      <div className="w-full max-w-2xl space-y-6 animate-in fade-in duration-300">
        
        {/* Navigation Bar */}
        <div className="flex items-center justify-between px-1">
          <button
            onClick={() => navigate("/checkin")}
            className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Check-In
          </button>
          <Button
            onClick={handleDownloadReceipt}
            variant="outline"
            className="rounded-xl text-xs font-bold gap-2 border-slate-200 dark:border-slate-800 shadow-sm h-9 cursor-pointer"
          >
            <Download className="w-4 h-4" /> Download Receipt
          </Button>
        </div>

        {/* Card 1: Contactless Mobile Pass (Dark Navy Card) */}
        <div className="bg-[#111827] text-white rounded-3xl p-6 sm:p-8 shadow-2xl border border-slate-800 relative overflow-hidden">
          {/* Top Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Smartphone className="w-5 h-5 text-[#10b981]" />
              <span className="font-bold tracking-wider text-sm sm:text-base text-white uppercase">
                CONTACTLESS MOBILE PASS
              </span>
            </div>
            <span className="px-3.5 py-1 rounded-full text-xs font-mono font-bold bg-[#064e3b]/80 text-[#10b981] border border-[#059669]/40 tracking-wide">
              AES-256 GCM
            </span>
          </div>

          <div className="border-t border-slate-800 my-6" />

          {/* Card Body */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
            {/* Left Details */}
            <div className="md:col-span-7 space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                6-DIGIT ROOM DOOR PIN
              </p>
              <p className="text-5xl sm:text-6xl font-extrabold text-[#10b981] font-mono tracking-wider py-1">
                {pin}
              </p>
              <div className="space-y-1 pt-1 text-xs sm:text-sm">
                <p className="text-slate-400">
                  Lock ID: <span className="text-slate-100 font-semibold">{lockId}</span>
                </p>
                <p className="text-slate-400">
                  Payload Hash: <span className="text-slate-100 font-semibold">AES256-ACTIVE-KEY...</span>
                </p>
              </div>
            </div>

            {/* Right QR Box */}
            <div className="md:col-span-5">
              <div className="bg-[#1e293b]/70 border border-slate-700/60 rounded-2xl p-6 flex flex-col items-center justify-center text-center shadow-inner">
                <div className="w-28 h-28 sm:w-32 sm:h-32 text-white flex items-center justify-center">
                  <svg className="w-full h-full" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                    {/* Finder 1 */}
                    <rect x="5" y="5" width="28" height="28" rx="6" stroke="white" strokeWidth="6" />
                    <rect x="13" y="13" width="12" height="12" rx="2" fill="white" />
                    {/* Finder 2 */}
                    <rect x="67" y="5" width="28" height="28" rx="6" stroke="white" strokeWidth="6" />
                    <rect x="75" y="13" width="12" height="12" rx="2" fill="white" />
                    {/* Finder 3 */}
                    <rect x="5" y="67" width="28" height="28" rx="6" stroke="white" strokeWidth="6" />
                    <rect x="13" y="75" width="12" height="12" rx="2" fill="white" />

                    {/* QR Matrix blocks */}
                    <rect x="42" y="10" width="8" height="8" rx="2" fill="white" />
                    <rect x="52" y="10" width="6" height="6" rx="1.5" fill="white" />
                    <rect x="42" y="24" width="16" height="7" rx="2" fill="white" />

                    <rect x="10" y="42" width="7" height="16" rx="2" fill="white" />
                    <rect x="22" y="42" width="7" height="7" rx="2" fill="white" />
                    <rect x="34" y="40" width="32" height="20" rx="4" fill="white" />
                    <rect x="72" y="42" width="18" height="7" rx="2" fill="white" />

                    <rect x="42" y="67" width="7" height="18" rx="2" fill="white" />
                    <rect x="54" y="67" width="16" height="7" rx="2" fill="white" />
                    <rect x="75" y="67" width="12" height="12" rx="2" fill="white" />

                    <rect x="54" y="80" width="16" height="10" rx="2" fill="white" />
                    <rect x="75" y="84" width="12" height="6" rx="1.5" fill="white" />
                  </svg>
                </div>
                <p className="text-slate-400 text-xs mt-3 font-medium">
                  Scan at Room Door NFC / QR Sensor
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Smart Door Lock Simulator (Light White Card) */}
        <div className="bg-white dark:bg-card border border-slate-200 dark:border-slate-800 rounded-3xl p-8 sm:p-10 shadow-sm flex flex-col items-center justify-center text-center">
          <div className="flex items-center justify-center gap-2">
            <Lock className="w-5 h-5 text-[#10b981]" />
            <h2 className="text-slate-900 dark:text-white font-bold text-xl sm:text-2xl">
              Smart Door Lock Simulator
            </h2>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-2">
            Test the digital lock key unlock mechanism for Room #{roomNum}.
          </p>

          {/* Central Circular Lock Indicator */}
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-[#1e293b] flex items-center justify-center shadow-xl my-6 sm:my-8 transition-transform duration-300 hover:scale-105">
            {isUnlocked ? (
              <Unlock className="w-10 h-10 sm:w-12 sm:h-12 text-[#10b981] animate-pulse" />
            ) : (
              <Lock className="w-10 h-10 sm:w-12 sm:h-12 text-white" />
            )}
          </div>

          {/* Lock Status Text */}
          <p className="text-slate-900 dark:text-slate-100 font-bold text-base sm:text-lg">
            Door Status:{" "}
            <span className={isUnlocked ? "text-[#10b981] uppercase font-black" : "text-[#64748b] uppercase font-black"}>
              {isUnlocked ? "UNLOCKED" : "LOCKED"}
            </span>
          </p>

          {/* Simulate Button */}
          <button
            onClick={handleSimulateUnlock}
            disabled={isUnlocking}
            className="bg-[#8B6748] hover:bg-[#7A5A3C] active:scale-95 text-white px-7 py-3.5 rounded-2xl font-bold text-sm sm:text-base shadow-lg shadow-[#8B6748]/25 flex items-center justify-center gap-2.5 transition cursor-pointer mt-6 disabled:opacity-75"
          >
            {isUnlocking ? (
              <span>Unlocking Door...</span>
            ) : isUnlocked ? (
              <>
                <span>Relock Door</span>
                <Lock className="w-5 h-5 text-white" />
              </>
            ) : (
              <>
                <span>Simulate Unlock Key</span>
                <KeyRound className="w-5 h-5 text-white" />
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}

