import React, { useState, useEffect, useRef } from "react";
import {
  ShieldCheck,
  Camera,
  KeyRound,
  FileBadge,
  CheckCircle2,
  QrCode,
  Lock,
  Unlock,
  Sparkles,
  RefreshCw,
  Search,
  User,
  Building2,
  Smartphone,
  BedDouble,
  ChevronRight,
  Download,
  CreditCard,
  Banknote,
  AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import QRCode from "qrcode";
import { api } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

// Sample Available Rooms List for Selection
const AVAILABLE_ROOMS = [
  { id: 101, type: "Deluxe King Suite", price: 189, floor: 1, capacity: 2, amenities: ["King Bed", "Ocean View", "Free WiFi", "Smart Lock"], image: "/rooms/deluxe.png" },
  { id: 102, type: "Cozy Family Suite", price: 219, floor: 1, capacity: 4, amenities: ["2 Queen Beds", "Home Movie Projector", "Family Lounge", "Smart Lock"], image: "/rooms/family.png" },
  { id: 201, type: "Penthouse Skyline Suite", price: 349, floor: 2, capacity: 3, amenities: ["Balcony View", "Jacuzzi", "High-speed Fiber", "Express Check-In"], image: "/rooms/premium.png" },
  { id: 202, type: "Standard Queen Room", price: 139, floor: 2, capacity: 2, amenities: ["Queen Bed", "Smart TV", "Air Conditioned"], image: "/rooms/standard.png" },
  { id: 301, type: "Executive Garden Suite", price: 279, floor: 3, capacity: 3, amenities: ["King Bed", "Garden Bay Window", "Chaise Lounge", "Mini Bar"], image: "/rooms/suite.png" }
];

type RazorpayResponse = {
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
};

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  prefill?: { name?: string; email?: string; contact?: string };
  handler: (response: RazorpayResponse) => void | Promise<void>;
  modal?: { ondismiss?: () => void };
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => {
      open: () => void;
      on: (event: string, handler: (response: any) => void) => void;
    };
  }
}

let razorpayScriptPromise: Promise<void> | null = null;

function loadRazorpayScript(): Promise<void> {
  if (typeof window !== "undefined" && window.Razorpay) {
    return Promise.resolve();
  }
  if (razorpayScriptPromise) return razorpayScriptPromise;

  razorpayScriptPromise = new Promise<void>((resolve, reject) => {
    if (typeof window !== "undefined" && window.Razorpay) {
      resolve();
      return;
    }

    // Check if script tag is already present in DOM
    const existing = document.querySelector('script[src*="checkout.razorpay.com"]') as HTMLScriptElement | null;
    if (existing) {
      let pollCount = 0;
      const interval = setInterval(() => {
        pollCount++;
        if (window.Razorpay) {
          clearInterval(interval);
          resolve();
        } else if (pollCount > 25) { // 2.5s timeout
          clearInterval(interval);
          razorpayScriptPromise = null;
          reject(new Error("Unable to load Razorpay Checkout (blocked by ad-blocker or network error)."));
        }
      }, 100);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      if (window.Razorpay) {
        resolve();
      } else {
        razorpayScriptPromise = null;
        reject(new Error("Razorpay Checkout is unavailable in this browser."));
      }
    };
    script.onerror = () => {
      razorpayScriptPromise = null;
      try {
        script.remove();
      } catch (_) {}
      reject(new Error("Unable to load Razorpay Checkout. Please disable ad-blockers or use front-desk Cash/Card."));
    };
    document.body.appendChild(script);
  });

  return razorpayScriptPromise;
}

export default function CheckInVerification() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { setTheme } = useTheme();
  const [reservations, setReservations] = useState<any[]>([]);
  const [selectedResId, setSelectedResId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Card Validation & Formatting Helper Functions
  const formatCardNumber = (val: string) => {
    const digits = val.replace(/\D/g, "").slice(0, 16);
    return digits.match(/.{1,4}/g)?.join(" ") || digits;
  };

  const validateCardNumber = (val: string) => {
    return val.replace(/\s/g, "").length === 16;
  };

  const formatExpiry = (val: string) => {
    let digits = val.replace(/\D/g, "").slice(0, 4);
    if (digits.length >= 3) {
      digits = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    }
    return digits;
  };

  const isCardExpired = (expiry: string) => {
    if (!expiry || !/^\d{2}\/\d{2}$/.test(expiry)) return false;
    const [mmStr, yyStr] = expiry.split("/");
    const month = parseInt(mmStr, 10);
    const year = parseInt(`20${yyStr}`, 10);
    if (month < 1 || month > 12) return true;
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    if (year < currentYear) return true;
    if (year === currentYear && month < currentMonth) return true;
    return false;
  };

  // Step flow for reserved guests: 1 = ID Verification, 2 = Payment Process, 3 = Digital Key Pass
  const [step, setStep] = useState<number>(1);
  const [paymentDone, setPaymentDone] = useState<boolean>(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [sendingReminder, setSendingReminder] = useState<boolean>(false);

  // Send 3-Hour Prior Check-in Reminder Notification
  const handleSend3HourReminder = async (resId?: string) => {
    const targetId = resId || selectedResId;
    if (!targetId) {
      toast.error("Please select a reservation to send 3-hour prior check-in reminder.");
      return;
    }
    setSendingReminder(true);
    try {
      const res = await api.post("/checkin/send-3h-reminder", { reservationId: targetId });
      setSendingReminder(false);
      if (res.data?.success) {
        toast.success(`Check-In Reminder notification sent 3 hours prior to check-in!`);
      } else {
        toast.success(`3-Hour prior check-in reminder notification dispatched to guest!`);
      }
    } catch (err) {
      setSendingReminder(false);
      toast.error((err as any)?.response?.data?.error || "Failed to send the 3-hour prior check-in reminder.");
    }
  };
  const [isBookingModalOpen, setIsBookingModalOpen] = useState<boolean>(false);

  // Room Booking & Payment Form State
  const [selectedRoom, setSelectedRoom] = useState<any>(AVAILABLE_ROOMS[0]);
  const [bookingData, setBookingData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    checkIn: new Date().toISOString().split("T")[0],
    checkOut: new Date(Date.now() + 86400000 * 2).toISOString().split("T")[0],
    paymentMethod: "Razorpay",
  });
  const [submittingBooking, setSubmittingBooking] = useState<boolean>(false);

  // Form / Camera State for ID Verification
  const [dlImage, setDlImage] = useState<string>("");
  const [selfieImage, setSelfieImage] = useState<string>("");
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Verification Results
  const [verifying, setVerifying] = useState<boolean>(false);
  const [verificationResult, setVerificationResult] = useState<any>(null);

  // Lock Key & Door Simulation
  const [keyDetails, setKeyDetails] = useState<any>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [downloadingDetails, setDownloadingDetails] = useState<boolean>(false);
  const [doorStatus, setDoorStatus] = useState<"LOCKED" | "UNLOCKED">("LOCKED");
  const [unlocking, setUnlocking] = useState<boolean>(false);
  const [completingCheckIn, setCompletingCheckIn] = useState<boolean>(false);
  const [checkInCompletedAnimation, setCheckInCompletedAnimation] = useState<boolean>(false);
  const [digitalKeyGenerated, setDigitalKeyGenerated] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    const qrPayload = keyDetails?.qrPayload;
    if (!qrPayload) {
      setQrCodeUrl("");
      return () => {
        cancelled = true;
      };
    }

    QRCode.toDataURL(JSON.stringify(qrPayload), {
      width: 320,
      margin: 2,
      color: { dark: "#5b3a29", light: "#fffaf0" },
    })
      .then((url) => {
        if (!cancelled) setQrCodeUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrCodeUrl("");
      });

    return () => {
      cancelled = true;
    };
  }, [keyDetails?.qrPayload]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const targetResId = params.get("resId") || params.get("reservationId");
    const checkInToken = params.get("token");

    if (checkInToken) {
      setTheme("light");
      localStorage.setItem("theme", "light");
      document.documentElement.classList.remove("dark");
      sessionStorage.setItem("innkeeper_checkin_token", checkInToken);
    }

    if (targetResId && checkInToken) {
      api.get("/checkin/access", { params: { resId: targetResId, token: checkInToken } })
        .then((res) => {
          const reservation = res.data?.reservation;
          if (reservation) {
            setReservations([reservation]);
            setSelectedResId(String(reservation.id));
          }
        })
        .catch((err) => toast.error(err?.response?.data?.error || "This check-in link is invalid or expired."));
    } else {
      fetchReservations(targetResId);
    }
  }, []);

  const fetchReservations = async (preferredResId?: string | null) => {
    try {
      const res = await api.get("/reservations");
      const data = res.data;
      let items = data.items || data || [];
      // Ensure reservations are strictly sorted in numeric sequential order by ID ascending
      items = items.slice().sort((a: any, b: any) => Number(a.id) - Number(b.id));
      setReservations(items);
      if (preferredResId && items.some((i: any) => String(i.id) === String(preferredResId))) {
        setSelectedResId(String(preferredResId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const selectedReservation = reservations.find((r) => String(r.id) === String(selectedResId));
  const isSelectedGuestCheckedIn = Boolean(
    selectedReservation && (selectedReservation.status || '').toLowerCase().includes('check')
  );
  const isSelectedGuestCancelled = Boolean(
    selectedReservation && (selectedReservation.status || '').toLowerCase() === 'cancelled'
  );

  // Determine current step based on explicit user progression
  useEffect(() => {
    if (!selectedReservation) return;

    // Auto pre-fill Cardholder Name with selected candidate's full name
    if (selectedReservation?.guest) {
      const fullName = `${selectedReservation.guest.firstName || ''} ${selectedReservation.guest.lastName || ''}`.trim();
      if (fullName) {
        setBookingData((prev) => ({ ...prev, cardHolder: fullName }));
      }
    }

    // Determine if payment is already completed for this reservation (via paidAmount or payments status)
    const hasPaid =
      (selectedReservation?.paidAmount != null && Number(selectedReservation.paidAmount) > 0) ||
      (Array.isArray(selectedReservation?.payments) &&
        selectedReservation.payments.some(
          (p: any) => (p.paymentStatus || p.status || '').toLowerCase() === 'paid'
        ));

    if (isSelectedGuestCheckedIn) {
      setStep(3);
      setCheckInCompletedAnimation(true);

      let cancelled = false;
      const restoreDigitalKey = async () => {
        if (!selectedReservation.digitalPin || !selectedReservation.lockId) {
          setDigitalKeyGenerated(false);
          return;
        }

        try {
          const response = await api.post("/checkin/generate-lock-key", {
            reservationId: selectedReservation.id,
          });
          const data = response.data;
          if (!cancelled && data.success && data.qrPayload) {
            const details = {
              digitalPin: data.digitalPin,
              lockId: data.lockId,
              qrPayload: data.qrPayload,
            };
            setKeyDetails(details);
            setDigitalKeyGenerated(true);
            sessionStorage.setItem("digitalKeyData", JSON.stringify({
              reservation: data.reservation || selectedReservation,
              keyDetails: details,
            }));
          }
        } catch (err) {
          if (!cancelled) {
            setDigitalKeyGenerated(false);
            toast.error((err as any)?.response?.data?.error || "Unable to load the digital key.");
          }
        }
      };

      restoreDigitalKey();
      return () => {
        cancelled = true;
      };
    } else if (selectedReservation?.verificationStatus === 'VERIFIED' && hasPaid) {
      setStep(3);
    } else if (selectedReservation?.verificationStatus === 'VERIFIED') {
      setStep(2);
    }
  }, [selectedResId, selectedReservation, isSelectedGuestCheckedIn]);

  const openRazorpayCheckout = async (paymentData: any, guest: any, onVerified: () => Promise<void> | void) => {
    const checkout = paymentData?.razorpay;
    if (!checkout?.keyId || !checkout.orderId || !Number.isFinite(Number(checkout.amount)) || Number(checkout.amount) <= 0 || checkout.currency !== "INR") {
      toast.error("The payment order response was invalid.");
      return;
    }

    return new Promise<void>(async (resolve) => {
      try {
        await loadRazorpayScript();
        if (!window.Razorpay) throw new Error("Razorpay Checkout is unavailable in this browser.");

        let finished = false;
        let verificationStarted = false;
        const finish = async (success: boolean, message?: string) => {
          if (finished) return;
          finished = true;
          try {
            if (success) {
              setPaymentError(null);
              await onVerified();
            } else {
              toast.error(message || "Payment was not completed.");
            }
          } finally {
            resolve();
          }
        };

        const razorpay = new window.Razorpay({
          key: checkout.keyId,
          amount: Number(checkout.amount),
          currency: checkout.currency,
          order_id: checkout.orderId,
          name: "InnKeeper",
          description: "Reservation payment",
          prefill: {
            name: guest ? `${guest.firstName || ""} ${guest.lastName || ""}`.trim() : undefined,
            email: guest?.email || undefined,
            contact: guest?.phone || undefined,
          },
          handler: async (response) => {
            verificationStarted = true;
            const orderId = response.razorpay_order_id || (response as any).razorpayOrderId;
            const paymentId = response.razorpay_payment_id || (response as any).razorpayPaymentId;
            const signature = response.razorpay_signature || (response as any).razorpaySignature;

            if (!orderId || !paymentId || !signature) {
              await finish(false, "Razorpay returned an invalid payment response.");
              return;
            }

            try {
              const verifyResponse = await api.post("/checkin/payment/verify", {
                reservationId: paymentData.reservation?.id,
                razorpayOrderId: orderId,
                razorpayPaymentId: paymentId,
                razorpaySignature: signature,
                razorpay_order_id: orderId,
                razorpay_payment_id: paymentId,
                razorpay_signature: signature,
              });
              const verifyData = verifyResponse.data;
              if (!verifyData?.success || verifyData.status !== "Paid") {
                await finish(false, verifyData?.error || "Payment verification failed.");
                return;
              }
              await finish(true);
            } catch (err: any) {
              await finish(false, err?.response?.data?.error || "Network error while verifying payment.");
            }
          },
          modal: {
            ondismiss: () => {
              if (!verificationStarted) void finish(false, "Payment window closed. No payment was recorded.");
            }
          },
        });

        razorpay.on("payment.failed", () => {
          verificationStarted = true;
          void finish(false, "Razorpay reported that the payment failed.");
        });
        razorpay.open();
      } catch (error: any) {
        const errorMsg = error?.message || "Unable to open Razorpay Checkout.";
        setPaymentError(errorMsg);
        toast.error("Unable to load Razorpay Checkout. You can record payment using Front-Desk Cash or Card below.");
        resolve();
      }
    });
  };

  // Handle Room Booking with Payment Gateway Details
  const handleCreateBookingWithPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingData.firstName || !bookingData.lastName) {
      toast.error("Please fill in Guest First & Last Name");
      return;
    }
    setSubmittingBooking(true);
    try {
      const res = await api.post("/checkin/book-with-payment", {
        ...bookingData,
        roomId: selectedRoom.id,
      });

      const data = res.data;
      if (data.success) {
        await openRazorpayCheckout(data, data.reservation?.guest, async () => {
          toast.success("Payment verified successfully. Room booking confirmed!");
          setPaymentDone(true);
          setIsBookingModalOpen(false);
          await fetchReservations();
          setSelectedResId(String(data.reservation.id));
          setStep(1);
        });
      } else {
        toast.error(data.error || "Booking & Payment failed.");
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Network error processing payment");
    } finally {
      setSubmittingBooking(false);
    }
  };

  // Handle Camera Capture for Selfie
  const startCamera = async () => {
    try {
      setIsCameraActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      toast.error("Unable to access camera for selfie capture");
      setIsCameraActive(false);
    }
  };

  const captureSelfie = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg");
      setSelfieImage(dataUrl);
      stopCamera();
      toast.success("Selfie captured successfully!");
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
    }
    setIsCameraActive(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: "DL" | "SELFIE") => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (type === "DL") {
          setDlImage(reader.result as string);
          toast.success("Driver License photo uploaded!");
        } else {
          stopCamera(); // Stop live webcam feed so uploaded photo displays immediately
          setSelfieImage(reader.result as string);
          toast.success("Selfie photo uploaded!");
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = "";
  };

  // Process Driving Licence verification on the backend.
  const handleVerifyId = async () => {
    const targetResId = selectedResId || (reservations.length > 0 ? String(reservations[0].id) : "");
    if (!targetResId) {
      toast.error("Please select a reservation first");
      return;
    }
    if (isSelectedGuestCheckedIn) {
      toast.info("This guest is already checked-in.");
      return;
    }
    if (isSelectedGuestCancelled) {
      toast.error("Selected reservation is cancelled or inactive for check-in.");
      return;
    }
    if (!dlImage) {
      toast.error("Please upload Driver License photo before submitting.");
      return;
    }

    if (!selectedResId) {
      setSelectedResId(targetResId);
    }

    setVerifying(true);
    setVerificationResult(null);

    try {
      const res = await api.post("/checkin/verify-id", {
        reservationId: targetResId,
        dlImageUrl: dlImage,
        selfieImageUrl: selfieImage,
      });

      const data = res.data;
      setVerifying(false);
      const backendVerification = data.verification || {};
      const faceVerified = backendVerification.faceVerified === true;
      const overallVerified = data.success === true && backendVerification.verified === true && faceVerified;
      const verificationMessage = backendVerification.reason || data.error || data.message || "Face identity verification failed.";
      const result = {
        verificationStatus: overallVerified ? "VERIFIED" : "REJECTED",
        faceVerified,
        faceDistance: backendVerification.faceDistance,
        faceThreshold: backendVerification.faceThreshold,
        model: backendVerification.model,
        message: verificationMessage,
      };

      if (overallVerified) {
        setVerificationResult(result);
        toast.success(verificationMessage || "Identity verification successful. Proceeding to Step 2...");
        qc.invalidateQueries({ queryKey: ["reservations"] });
        qc.invalidateQueries({ queryKey: ["guests"] });
        qc.invalidateQueries({ queryKey: ["payments"] });
        qc.invalidateQueries({ queryKey: ["rooms"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
        fetchReservations(targetResId);
        setStep(2); // Automatically advance directly to Step 2 (Payment Process)
      } else {
        setVerificationResult(result);
        toast.error(verificationMessage);
      }
    } catch (err: any) {
      setVerifying(false);
      const data = err?.response?.data;
      if (data) {
        const backendVerification = data.verification || {};
        const verificationMessage = backendVerification.reason || data.error || data.message || "Face identity verification failed.";
        setVerificationResult({
          verificationStatus: "REJECTED",
          faceVerified: backendVerification.faceVerified === true,
          faceDistance: backendVerification.faceDistance,
          faceThreshold: backendVerification.faceThreshold,
          model: backendVerification.model,
          message: verificationMessage,
        });
        toast.error(verificationMessage);
      } else {
        setVerificationResult({
          verificationStatus: "REJECTED",
          faceVerified: false,
          message: err.message || "Face verification service is unavailable. Please try again.",
        });
        toast.error(err.message || "Face verification service is unavailable. Please try again.");
      }
    }
  };

  // Handle Step 2: Create and verify a Razorpay payment
  const handleCompletePaymentProcess = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedResId) {
      toast.error("Please select a reservation first");
      return;
    }

    setSubmittingBooking(true);
    setPaymentError(null);
    try {
      const res = await api.post("/checkin/process-payment", {
        reservationId: selectedResId,
      });

      const data = res.data;
      if (!data.success) {
        setPaymentError(data.error || "Unable to create payment order.");
        toast.error(data.error || "Unable to create payment order.");
        return;
      }

      await openRazorpayCheckout(data, selectedReservation?.guest, async () => {
        setPaymentDone(true);
        setPaymentError(null);
        qc.invalidateQueries({ queryKey: ["payments"] });
        qc.invalidateQueries({ queryKey: ["reservations"] });
        toast.success("Payment verified successfully. Completing check-in and issuing your digital key...");
        await handleCompleteCheckIn();
      });
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Network error while creating payment order.";
      setPaymentError(msg);
      toast.error(msg);
    } finally {
      setSubmittingBooking(false);
    }
  };

  // Front-desk alternative to Razorpay: record a cash/card/manual payment collected in person or externally.
  const handleManualPayment = async (method: "Cash" | "Card" | "Razorpay") => {
    if (!selectedResId) {
      toast.error("Please select a reservation first");
      return;
    }
    setSubmittingBooking(true);
    try {
      const res = await api.post("/checkin/manual-payment", { reservationId: selectedResId, method });
      const data = res.data;
      if (!data.success) {
        toast.error(data.error || "Unable to record payment.");
        return;
      }
      setPaymentDone(true);
      setPaymentError(null);
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["reservations"] });
      toast.success(data.message || "Payment recorded. Completing check-in and issuing your digital key...");
      await handleCompleteCheckIn();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Network error while recording payment.");
    } finally {
      setSubmittingBooking(false);
    }
  };

  // Step 3 of Completion: Complete Check-In API call -> Marks reservation Checked-In & opens Check-In Completed Animation Page
  const handleCompleteCheckIn = async () => {
    if (!selectedResId) return;
    setCompletingCheckIn(true);

    try {
      const res = await api.post("/checkin/complete", { reservationId: selectedResId });

      const data = res.data;
      setCompletingCheckIn(false);

      if (!data.success) {
        toast.error(data.error || "Unable to complete check-in.");
        return;
      }

      if (!data.digitalPin || !data.lockId || !data.qrPayload) {
        toast.error("The server did not return a valid digital key.");
        return;
      }
      const details = { digitalPin: data.digitalPin, lockId: data.lockId, qrPayload: data.qrPayload };
      setStep(3);
      setCheckInCompletedAnimation(true);
      setKeyDetails({ digitalPin: data.digitalPin, lockId: data.lockId, qrPayload: data.qrPayload });
      setDigitalKeyGenerated(true);
      sessionStorage.setItem("digitalKeyData", JSON.stringify({
        reservation: data.reservation || selectedReservation,
        keyDetails: details,
      }));
      toast.success("Check-in completed successfully!");

      qc.invalidateQueries({ queryKey: ["reservations"] });
      qc.invalidateQueries({ queryKey: ["rooms"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      if (sessionStorage.getItem("innkeeper_checkin_token")) {
        setReservations([data.reservation]);
      } else {
        fetchReservations();
      }
    } catch (err: any) {
      setCompletingCheckIn(false);
      toast.error(err?.response?.data?.error || "Network error while completing check-in.");
    }
  };

  // Validate the application credential through the server-side authorization flow.
  const handleSimulateUnlock = async () => {
    if (!selectedResId) return;
    setUnlocking(true);
    try {
      const res = await api.post("/checkin/unlock-door", {
        reservationId: selectedResId,
        digitalPin: keyDetails?.digitalPin,
      });

      const data = res.data;
      setUnlocking(false);

      if (data.success) {
        setDoorStatus("UNLOCKED");
        toast.success(data.message || "Application key validated successfully.");
        setTimeout(() => setDoorStatus("LOCKED"), 4000);
      } else {
        setDoorStatus("LOCKED");
        toast.error(data.message || "Application key validation failed.");
      }
    } catch (err) {
      setUnlocking(false);
      setDoorStatus("LOCKED");
      toast.error((err as any)?.response?.data?.error || "Application key validation failed.");
    }
  };

  const handleDownloadCheckInDetails = async () => {
    if (!selectedReservation || !keyDetails?.qrPayload || !qrCodeUrl) {
      toast.error("Check-in details are not ready to download yet.");
      return;
    }

    setDownloadingDetails(true);
    try {
      const guestName = selectedReservation.guest
        ? `${selectedReservation.guest.firstName || ""} ${selectedReservation.guest.lastName || ""}`.trim()
        : "Guest";
      const roomNumber = selectedReservation.roomNumber || selectedReservation.room?.room_number || selectedReservation.roomId || "Unavailable";
      const roomType = selectedReservation.room?.room_type?.name || selectedReservation.room?.type || selectedReservation.roomType || "Unavailable";
      const escapeHtml = (value: unknown) => String(value ?? "Unavailable")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
      const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>InnKeeper Check-In Details</title>
<style>body{font-family:Georgia,serif;color:#4a3022;background:#fffaf0;padding:40px;max-width:760px;margin:auto}h1{color:#6f4b36;border-bottom:2px solid #c4a882;padding-bottom:12px}.section{border:1px solid #d8c4a8;padding:18px;margin:18px 0;background:#fffdf8}.row{display:flex;justify-content:space-between;border-bottom:1px solid #eee2d2;padding:8px 0}.label{color:#80644d}.value{font-weight:700}.qr{text-align:center;margin:24px}.qr img{width:260px;border:8px solid #fff;border-radius:8px;box-shadow:0 2px 12px #b89572}.note{font-size:12px;color:#80644d;text-align:center}</style></head>
<body><h1>InnKeeper Check-In Details</h1>
<div class="section"><h2>Guest Details</h2><div class="row"><span class="label">Guest name</span><span class="value">${escapeHtml(guestName)}</span></div><div class="row"><span class="label">Reservation ID</span><span class="value">RES-${escapeHtml(selectedReservation.id)}</span></div><div class="row"><span class="label">Check-in status</span><span class="value">Checked In</span></div></div>
<div class="section"><h2>Room Details</h2><div class="row"><span class="label">Room number</span><span class="value">${escapeHtml(roomNumber)}</span></div><div class="row"><span class="label">Room type</span><span class="value">${escapeHtml(roomType)}</span></div><div class="row"><span class="label">Check-in</span><span class="value">${escapeHtml(selectedReservation.checkIn)}</span></div><div class="row"><span class="label">Check-out</span><span class="value">${escapeHtml(selectedReservation.checkOut)}</span></div></div>
<div class="section"><h2>Verification</h2><div class="row"><span class="label">Identity verification</span><span class="value">Verified</span></div><div class="row"><span class="label">Face verification</span><span class="value">Verified</span></div><div class="row"><span class="label">Payment</span><span class="value">Confirmed</span></div></div>
<div class="section"><h2>Digital Key</h2><div class="row"><span class="label">Digital key status</span><span class="value">Ready</span></div><div class="row"><span class="label">Lock ID</span><span class="value">${escapeHtml(keyDetails.lockId)}</span></div><div class="row"><span class="label">Room Door PIN</span><span class="value">${escapeHtml(keyDetails.digitalPin)}</span></div><div class="qr"><img src="${qrCodeUrl}" alt="Secure digital access credential QR code"><h3>Scan to Access</h3><p>Secure Digital Access Credential</p></div><p class="note">Physical smart-lock integration is not connected.</p></div>
</body></html>`;
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `InnKeeper_CheckIn_Details_RES-${selectedReservation.id}.html`;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Check-in details downloaded.");
    } catch {
      toast.error("Unable to download check-in details. Please try again.");
    } finally {
      setDownloadingDetails(false);
    }
  };

  const filteredReservations = reservations.filter((r) => {
    const name = `${r.guest?.firstName || ""} ${r.guest?.lastName || ""}`.toLowerCase();
    return name.includes(searchQuery.toLowerCase()) || String(r.id).includes(searchQuery);
  });

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-12">
      {/* 3-Hour Prior Check-In Notification Banner */}
      <div className="bg-gradient-to-r from-[#8B6748]/12 via-[#C4A882]/12 to-[#F3EDE4]/40 border border-[#B89572]/40 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="h-11 w-11 rounded-xl bg-[#8B6748] text-white flex items-center justify-center font-bold shadow-md shrink-0">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#8B6748] dark:text-[#DDBC9E] uppercase tracking-wider">3-Hour Prior Alert System</span>
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            </div>
            <h3 className="text-sm font-bold text-foreground">{t("checkin.reminderAlertTitle")}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("checkin.reminderAlertBody")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <Button
            onClick={() => handleSend3HourReminder()}
            disabled={sendingReminder}
            size="sm"
            className="w-full md:w-auto bg-[#8B6748] hover:bg-[#6B563E] text-white rounded-xl text-xs font-semibold px-4 py-2 gap-2 shadow-sm cursor-pointer"
          >
            {sendingReminder ? t("common.submitting") : t("checkin.send3hReminder")}
          </Button>
        </div>
      </div>



      {/* Candidate Selection Banner */}
      <div className="bg-card rounded-2xl border border-[#B89572]/40 dark:border-[#B89572]/40 p-6 shadow-md space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <span className="text-xs font-extrabold uppercase tracking-widest text-[#8B6748] dark:text-[#DDBC9E] bg-[#F3EDE4]/70 px-3 py-1 rounded-full">
              {t("checkin.step0Title")}
            </span>
            <h3 className="text-lg font-extrabold flex items-center gap-2 text-foreground mt-2">
              <User className="w-5 h-5 text-[#8B6748]" /> {t("checkin.selectCandidateHeader")}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t("checkin.selectCandidateSub")}</p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Select
              value={selectedResId || undefined}
              onValueChange={(val) => {
                const targetId = val === "none" ? "" : val;
                setSelectedResId(targetId);
                const target = reservations.find((r) => String(r.id) === String(targetId));
                const isTargetCheckedIn = Boolean(target && (target.status || '').toLowerCase().includes('check'));
                if (isTargetCheckedIn) {
                  setStep(3);
                } else if (target && target.verificationStatus === 'VERIFIED') {
                  setStep(2);
                } else {
                  setStep(1);
                }
                setPaymentDone(false);
                setDlImage("");
                setSelfieImage("");
                setVerificationResult(null);
                setCheckInCompletedAnimation(false);
                setDigitalKeyGenerated(false);
              }}
            >
              <SelectTrigger className="bg-card border-2 border-[#B89572]/60 rounded-xl px-4 py-3 h-auto text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-[#8B6748] w-full sm:w-80 shadow-md cursor-pointer">
                <SelectValue placeholder={t("checkin.chooseCandidatePlaceholder")} />
              </SelectTrigger>
              <SelectContent className="bg-card border-2 border-[#B89572]/40 rounded-xl shadow-2xl max-h-80 w-[var(--radix-select-trigger-width)] z-[100] p-1.5">
                <SelectItem value="none" className="text-xs font-medium text-muted-foreground cursor-pointer rounded-lg py-2 px-3 data-[highlighted]:bg-primary/10 data-[highlighted]:text-primary">
                  {t("checkin.chooseCandidatePlaceholder")}
                </SelectItem>
                {reservations.map((r) => {
                  const name = r.guest ? `${r.guest.firstName} ${r.guest.lastName}` : `Guest #${r.guestId || r.id}`;
                  const resCode = `RES-${String(r.id).padStart(4, '0')}`;
                  const roomNum = r.roomNumber || r.room?.room_number || r.room?.number || r.roomId || "—";
                  const isIdDone = r.verificationStatus === "VERIFIED" || Boolean(r.dlImageUrl);
                  const statusLower = (r.status || '').toLowerCase();
                  const isCheckedIn = statusLower.includes('check');
                  const isCancelled = statusLower === 'cancelled';
                  const isCancellationRequested = statusLower === 'cancellation_requested';

                  let tag = t("checkin.pendingId", "Pending ID");
                  if (isCheckedIn) {
                    tag = t("reservations.checkedIn", "Checked In");
                  } else if (isCancelled) {
                    tag = t("reservations.cancelled", "Cancelled");
                  } else if (isCancellationRequested) {
                    tag = t("reservations.cancellationRequested", "Cancellation Requested");
                  } else if (isIdDone) {
                    tag = t("checkin.identityVerified", "Identity Verified");
                  }

                  const roomLabel = roomNum !== "—" ? t("roomDrawer.roomNumber", { number: roomNum }) : "—";

                  return (
                    <SelectItem
                      key={r.id}
                      value={String(r.id)}
                      className="text-xs font-semibold cursor-pointer rounded-lg py-2.5 px-3 data-[highlighted]:bg-primary/15 data-[highlighted]:text-primary focus:bg-primary/15 focus:text-primary transition-colors"
                    >
                      {resCode} - {name} ({roomLabel}) [{tag}]
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </div>

        {selectedReservation ? (
          isSelectedGuestCheckedIn ? (
            <div className="pt-4">
              <div className="bg-card border border-border rounded-3xl p-8 shadow-xl text-center max-w-md mx-auto space-y-4 animate-in fade-in zoom-in duration-300">
                <div className="w-16 h-16 rounded-full bg-[#8B6748] text-white flex items-center justify-center mx-auto shadow-lg shadow-[#8B6748]/30">
                  <CheckCircle2 className="w-9 h-9" />
                </div>

                <div>
                  <span className="text-[11px] font-extrabold tracking-widest uppercase text-[#8B6748] dark:text-[#DDBC9E] bg-[#F3EDE4]/70 px-3.5 py-1 rounded-full">
                    {t("checkin.completedBadge")}
                  </span>
                  <h3 className="text-xl font-black text-foreground mt-3 leading-tight">
                    {t("checkin.completedHeading")}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Reservation RES-{String(selectedReservation.id).padStart(4, '0')} for <span className="font-semibold text-foreground">{selectedReservation.guest ? `${selectedReservation.guest.firstName} ${selectedReservation.guest.lastName}` : "Guest"}</span> is active.
                  </p>
                </div>

                <div className="pt-1">
                  <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#F3EDE4]/70 text-[#8B6748] dark:text-[#DDBC9E] text-xs font-bold border border-[#B89572]/30">
                    ✓ {t("roomDrawer.roomNumber", { number: selectedReservation.roomNumber || selectedReservation.room?.room_number || selectedReservation.room?.number || selectedReservation.roomId || "Unavailable" })} · {t("reservations.checkedIn")}
                  </span>
                </div>
              </div>
            </div>
          ) : isSelectedGuestCancelled ? (
            <div className="pt-4">
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-3xl p-8 shadow-xl text-center max-w-md mx-auto space-y-3 animate-in fade-in zoom-in duration-300">
                <div className="w-14 h-14 rounded-full bg-rose-500 text-white flex items-center justify-center mx-auto shadow-lg shadow-rose-500/30 font-bold text-lg">
                  ✕
                </div>

                <div>
                  <span className="text-[11px] font-extrabold tracking-widest uppercase text-rose-600 dark:text-rose-400 bg-rose-500/15 px-3.5 py-1 rounded-full">
                    {t("checkin.cancelledBadge", "RESERVATION CANCELLED")}
                  </span>
                  <h3 className="text-lg font-black text-foreground mt-2 leading-tight">
                    {t("checkin.cancelledHeading", "This reservation has been cancelled")}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {t("checkin.cancelledBody", {
                      code: `RES-${String(selectedReservation.id).padStart(4, '0')}`,
                      name: selectedReservation.guest ? `${selectedReservation.guest.firstName} ${selectedReservation.guest.lastName}` : "Guest",
                      defaultValue: `Reservation RES-${String(selectedReservation.id).padStart(4, '0')} is cancelled. Please choose an active reservation to proceed.`
                    })}
                  </p>
                </div>
              </div>
            </div>
          ) : null
        ) : (
          <div className="p-4 rounded-xl bg-[#F3EDE4]/70 border border-[#B89572]/30 text-[#8B6748] dark:text-[#DDBC9E] text-xs font-bold text-center">
            {t("checkin.selectCandidateAlert")}
          </div>
        )}
      </div>



      {/* Conditionally Render Workflow Steps ONLY when a Candidate is selected and NOT already checked in and NOT cancelled */}
      {selectedResId && (!isSelectedGuestCheckedIn || checkInCompletedAnimation) && !isSelectedGuestCancelled && (
        <>
          {/* STEP 1: ID Verification */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="bg-card rounded-2xl border border-border p-6 shadow-sm space-y-6">
                {/* Top Header & Reserved Guest Selector Dropdown */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border pb-5">
                  <div>
                    <h2 className="text-lg font-bold flex items-center gap-2">
                      <FileBadge className="w-5 h-5 text-[#8B6748]" /> {t("checkin.step1Heading")}
                    </h2>
                    <p className="text-xs text-muted-foreground">{t("checkin.step1Subtitle")}</p>
                  </div>

                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2.5 w-full md:w-auto bg-accent/40 p-2.5 rounded-xl border border-border">
                    <span className="text-xs font-bold text-foreground shrink-0">{t("checkin.reservedGuest")}</span>
                    <select
                      value={selectedResId}
                      onChange={(e) => {
                        const targetId = e.target.value;
                        setSelectedResId(targetId);
                        const target = reservations.find((r) => String(r.id) === String(targetId));
                        if (target && target.verificationStatus === 'VERIFIED' && !(target.status || '').toLowerCase().includes('check')) {
                          setStep(2);
                        } else {
                          setStep(1);
                        }
                        setVerificationResult(null);
                      }}
                      className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-[#8B6748] w-full sm:w-72"
                    >
                      {reservations.map((r) => {
                        const name = r.guest ? `${r.guest.firstName} ${r.guest.lastName}` : `Guest #${r.guestId || r.id}`;
                        const resCode = `RES-${String(r.id).padStart(4, '0')}`;
                        const roomNum = r.roomNumber || r.room?.room_number || r.room?.number || r.roomId || "—";
                        const isCheckedIn = (r.status || '').toLowerCase().includes('check');
                        return (
                          <option key={r.id} value={String(r.id)}>
                            {resCode} - {name} ({t("dashboard.rooms")} #{roomNum}){isCheckedIn ? ` [${t("reservations.checkedIn")}]` : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                {selectedReservation && selectedReservation.verificationStatus === 'VERIFIED' ? (
                  <div className="bg-emerald-500/10 border-2 border-emerald-500/30 rounded-3xl p-8 text-center max-w-lg mx-auto space-y-4 my-4 shadow-lg animate-in fade-in zoom-in duration-300">
                    <div className="w-14 h-14 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto shadow-md">
                      <CheckCircle2 className="w-8 h-8" />
                    </div>
                    <div>
                      <span className="text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-500/20 px-3.5 py-1 rounded-full">
                        ✓ మొదటి దశ పూర్తయింది (Step 1 Complete)
                      </span>
                      <h3 className="text-xl font-bold text-foreground mt-3">
                        గుర్తింపు తనిఖీ విజయవంతంగా పూర్తయింది!
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                        ఈ గెస్ట్ కోసం డ్రైవర్ లైసెన్స్ & సెల్ఫీ తనిఖీ పూర్తయింది. దయచేసి తదుపరి చెల్లింపు ప్రక్రియ (Step 2: Payment) కి కొనసాగండి.
                      </p>
                    </div>
                    <div className="pt-3">
                      <Button
                        onClick={() => setStep(2)}
                        className="w-full sm:w-auto bg-[#8B6748] hover:bg-[#6B563E] text-white rounded-xl text-xs font-bold px-4 sm:px-6 py-3 shadow-md gap-2 cursor-pointer flex items-center justify-center"
                      >
                        <span>కొనసాగించండి: చెల్లింపు ప్రక్రియ (Continue to Step 2: Payment)</span>
                        <ChevronRight className="w-4 h-4 shrink-0" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {selectedReservation && selectedReservation.verificationStatus === 'REJECTED' && (
                      <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs font-bold flex items-center justify-between">
                        <span>✕ Face identity verification failed. Please upload a clearer ID image and selfie.</span>
                      </div>
                    )}

                {/* DL and Selfie Verification Interfaces */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Driver License Upload Box */}
                  <div className="border border-border rounded-2xl p-5 bg-accent/20 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-bold text-sm">
                        <FileBadge className="w-4 h-4 text-[#8B6748]" /> {t("checkin.driverLicenseVerification")}
                      </div>
                      {dlImage && <CheckCircle2 className="w-5 h-5 text-[#8B6748]" />}
                    </div>

                    <div className="relative h-52 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center overflow-hidden bg-card">
                      {dlImage ? (
                        <img src={dlImage} alt="Driver License" className="w-full h-full object-cover" />
                      ) : (
                        <div className="text-center p-4">
                          <FileBadge className="w-10 h-10 mx-auto text-muted-foreground/40 mb-2" />
                          <p className="text-xs font-bold">{t("checkin.uploadDL")}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">{t("checkin.dlSupports")}</p>
                        </div>
                      )}
                    </div>

                    <label className="block w-full">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleFileUpload(e, "DL")}
                        className="hidden"
                      />
                      <div className="cursor-pointer text-center py-2.5 px-4 border border-border hover:bg-accent rounded-xl text-xs font-semibold transition">
                        {dlImage ? t("checkin.changeDL") : t("checkin.uploadDLFile")}
                      </div>
                    </label>
                  </div>

                  {/* Selfie Camera Capture Box */}
                  <div className="border border-border rounded-2xl p-5 bg-accent/20 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-bold text-sm">
                        <Camera className="w-4 h-4 text-[#8B6748]" /> {t("checkin.liveSelfieVerification")}
                      </div>
                      {selfieImage && <CheckCircle2 className="w-5 h-5 text-[#8B6748]" />}
                    </div>

                    <div className="relative h-52 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center overflow-hidden bg-card">
                      {isCameraActive ? (
                        <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover rounded-xl" />
                      ) : selfieImage ? (
                        <img src={selfieImage} alt="Live Selfie" className="w-full h-full object-cover" />
                      ) : (
                        <div className="text-center p-4">
                          <Camera className="w-10 h-10 mx-auto text-muted-foreground/40 mb-2" />
                          <p className="text-xs font-bold">{t("checkin.takeSelfie")}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">{t("checkin.selfieCaptures")}</p>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {isCameraActive ? (
                        <Button onClick={captureSelfie} className="w-full bg-[#8B6748] hover:bg-[#6B563E] text-white rounded-xl text-xs font-bold shadow-xs">
                          {t("checkin.snapSelfie")}
                        </Button>
                      ) : (
                        <Button onClick={startCamera} variant="outline" className="w-full rounded-xl text-xs font-semibold gap-1.5 shadow-xs">
                          <Camera className="w-3.5 h-3.5" /> {selfieImage ? t("checkin.retakeSelfie") : t("checkin.startWebcam")}
                        </Button>
                      )}

                      <label className="block w-full">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleFileUpload(e, "SELFIE")}
                          className="hidden"
                        />
                        <div className="cursor-pointer text-center py-2.5 px-3 border border-border hover:bg-accent rounded-xl text-xs font-semibold transition shadow-xs truncate">
                          {t("checkin.upload")}
                        </div>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Verification Processing Alert */}
                {verificationResult && (
                  <div
                    className={`p-4 rounded-xl border transition-all ${verificationResult.verificationStatus === "VERIFIED"
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                        : "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400"
                      }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {verificationResult.verificationStatus === "VERIFIED" ? (
                          <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-rose-500 text-white flex items-center justify-center font-bold text-xs shrink-0">
                            ✕
                          </div>
                        )}
                        <div>
                          <h4 className="font-bold text-sm">
                            {verificationResult.verificationStatus === "VERIFIED"
                              ? t("checkin.identityVerifiedSuccess")
                              : t("checkin.identityVerifiedFailed")}
                          </h4>
                          <p className="text-xs mt-0.5 opacity-90">
                            {verificationResult.message}
                          </p>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold mt-2">
                            <span>Face Match: {verificationResult.faceVerified ? "Verified" : "Not verified"}</span>
                            {verificationResult.model && <span>Model: {verificationResult.model}</span>}
                          </div>
                          {verificationResult.verificationStatus !== "VERIFIED" && (
                            <p className="text-xs font-semibold mt-1.5 text-rose-600 dark:text-rose-400">
                              {t("checkin.verifyFailedRetry")}
                            </p>
                          )}
                        </div>
                      </div>
                      {verificationResult.verificationStatus === "VERIFIED" && (
                        <Button
                          onClick={() => setStep(2)}
                          title="Proceed to Next Step"
                          className="w-full sm:w-auto bg-[#8B6748] hover:bg-[#6B563E] text-white rounded-xl text-xs font-bold px-4 py-2.5 shrink-0 gap-1.5 shadow-md transition hover:scale-105 flex items-center justify-center cursor-pointer"
                        >
                          <span>{t("checkin.nextStep")}</span>
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="border-t border-border pt-6 flex flex-col sm:flex-row justify-between items-center gap-4">
                  <div className="text-xs text-muted-foreground">
                    {t("checkin.step1Subtitle")}
                  </div>
                  <Button
                    onClick={() => {
                      handleVerifyId();
                    }}
                    disabled={verifying}
                    className="w-full sm:w-auto h-14 bg-[#8B6748] hover:bg-[#6B563E] text-white rounded-2xl text-base font-extrabold px-10 gap-3 shadow-xl shadow-[#8B6748]/25 cursor-pointer disabled:opacity-50 transition hover:scale-102"
                  >
                    {verifying ? (
                      <>
                        <RefreshCw className="w-5 h-5 animate-spin" /> {t("checkin.verifyingId")}
                      </>
                    ) : (
                      <>
                        {t("common.submit")} <ChevronRight className="w-5 h-5" />
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* STEP 2: Payment Process */}
      {step === 2 && selectedReservation && (
        <div className="w-full max-w-lg mx-auto bg-card rounded-3xl border border-border p-4 sm:p-6 shadow-xl space-y-5 animate-in fade-in duration-300">
          <div className="flex justify-between items-center pb-1">
            <div>
              <h3 className="text-sm font-bold text-foreground">Step 2: Collect Reservation Payment</h3>
              <p className="text-xs font-medium text-muted-foreground mt-0.5">
                Complete securely via Razorpay Checkout or choose front-desk payment.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setStep(1)} className="rounded-xl text-xs">
              Back
            </Button>
          </div>

          <form onSubmit={handleCompletePaymentProcess} className="space-y-4">
            {/* Server-calculated payment summary */}
            {(() => {
              const totalCost = Number(selectedReservation.totalCharges);
              const formattedTotal = Number.isFinite(totalCost) && totalCost > 0
                ? `₹${totalCost.toFixed(2)}`
                : "Unavailable";

              return (
                <div className="rounded-2xl border border-border bg-accent/30 p-4 space-y-2.5">
                  <div className="flex justify-between items-center text-xs font-medium text-muted-foreground">
                    <span>Reservation total (server-calculated)</span>
                    <span className="font-semibold text-foreground">{formattedTotal}</span>
                  </div>
                  <div className="border-b border-dashed border-border pt-1" />
                  <div className="flex justify-between items-center text-sm font-bold text-foreground pt-1">
                    <span>Total payment</span>
                    <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">
                      {formattedTotal}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Error / Ad-blocker notification banner */}
            {paymentError && (
              <div className="rounded-2xl border border-amber-300/80 bg-amber-50/90 dark:bg-amber-950/40 p-4 text-xs text-amber-950 dark:text-amber-200 space-y-2.5">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold">Gateway Connection Notice</p>
                    <p className="text-muted-foreground leading-relaxed">
                      {paymentError.includes("Unable to load")
                        ? "Razorpay Checkout script was blocked from loading. This usually happens if an ad-blocker (uBlock, Brave Shields) or firewall is active."
                        : paymentError}
                    </p>
                    <p className="font-semibold text-foreground pt-0.5">
                      You can retry Razorpay or proceed immediately with Front-Desk options below:
                    </p>
                  </div>
                </div>
                <div className="pt-1 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleCompletePaymentProcess()}
                    disabled={submittingBooking}
                    className="h-8 rounded-xl text-xs border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                  >
                    <RefreshCw className="w-3 h-3 mr-1.5" /> Retry Razorpay
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleManualPayment("Razorpay")}
                    disabled={submittingBooking}
                    className="h-8 rounded-xl text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Confirm Payment & Proceed
                  </Button>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-dashed border-border bg-accent/20 p-3.5 text-xs text-muted-foreground">
              Razorpay Checkout securely collects card, UPI, and net banking payments.
            </div>

            {/* Authorize Payment Action Button */}
            <Button
              type="submit"
              disabled={submittingBooking}
              className="w-full h-12 bg-[#8B6748] hover:bg-[#755438] text-white rounded-2xl text-sm font-extrabold shadow-lg shadow-[#8B6748]/25 flex items-center justify-center gap-2 mt-2 cursor-pointer transition-all active:scale-[0.99]"
            >
              {submittingBooking ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Authorizing Payment...
                </>
              ) : (
                <>Pay with Razorpay <ChevronRight className="w-4 h-4" /></>
              )}
            </Button>
          </form>

          {/* Front Desk Alternative Payment Options */}
          <div className="pt-2 space-y-3">
            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-border"></div>
              <span className="flex-shrink mx-3 text-[11px] uppercase tracking-wider text-muted-foreground font-bold">
                Or Front-Desk Payment
              </span>
              <div className="flex-grow border-t border-border"></div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={submittingBooking}
                onClick={() => handleManualPayment("Cash")}
                className="h-11 rounded-2xl text-xs font-bold border-border bg-card hover:bg-emerald-50 dark:hover:bg-emerald-950/20 hover:text-emerald-700 dark:hover:text-emerald-400 hover:border-emerald-300 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Banknote className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                Pay with Cash
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={submittingBooking}
                onClick={() => handleManualPayment("Card")}
                className="h-11 rounded-2xl text-xs font-bold border-border bg-card hover:bg-blue-50 dark:hover:bg-blue-950/20 hover:text-blue-700 dark:hover:text-blue-400 hover:border-blue-300 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <CreditCard className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                Card at Desk (POS)
              </Button>
            </div>

            <Button
              type="button"
              variant="ghost"
              disabled={submittingBooking}
              onClick={() => handleManualPayment("Razorpay")}
              className="w-full h-9 rounded-xl text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              Direct Verification (Guest paid via QR / Link)
            </Button>
          </div>
        </div>
      )}


          {/* STEP 3: Complete Check-In & Digital Key Delivery */}
          {step === 3 && selectedReservation && (
            <div className="space-y-6">
              {!checkInCompletedAnimation ? (
                /* Step 3: Complete Check-In Page (Rendered directly after Step 2 payment) */
                <div className="bg-card border border-border rounded-3xl p-8 shadow-xl text-center max-w-xl mx-auto space-y-6 animate-in fade-in duration-300">
                  <div className="w-20 h-20 rounded-full bg-[#F3EDE4]/70 text-[#8B6748] flex items-center justify-center mx-auto border border-[#B89572]/30">
                    <CheckCircle2 className="w-10 h-10" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-foreground">{t("checkin.completeCheckInTitle")}</h3>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      {t("checkin.completeCheckInSub")}
                    </p>
                  </div>

                  <div className="bg-accent/40 p-4 rounded-xl text-xs space-y-2 text-left">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("checkin.guestCandidateLabel")}</span>
                      <span className="font-semibold">{selectedReservation.guest ? `${selectedReservation.guest.firstName} ${selectedReservation.guest.lastName}` : "Guest"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("checkin.step1Title")}:</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">✓ VERIFIED</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("checkin.step2Title")}:</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">✓ AUTHORIZED</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("checkin.assignedRoomLabel")}</span>
                      <span className="font-bold text-[#8B6748] dark:text-[#DDBC9E]">
                        {t("dashboard.rooms")} #{selectedReservation.roomNumber || selectedReservation.room?.room_number || selectedReservation.room?.number || selectedReservation.roomId || "Unavailable"}
                      </span>
                    </div>
                  </div>

                  <Button
                    onClick={handleCompleteCheckIn}
                    disabled={completingCheckIn}
                    className="w-full h-14 bg-[#8B6748] hover:bg-[#6B563E] text-white rounded-2xl text-base font-extrabold shadow-xl shadow-[#8B6748]/25 flex items-center justify-center gap-3 cursor-pointer"
                  >
                    {completingCheckIn ? (
                      <>
                        <RefreshCw className="w-5 h-5 animate-spin" /> {t("checkin.completingCheckIn")}
                      </>
                    ) : (
                      <>
                        {t("checkin.completeCheckInTitle")} <ChevronRight className="w-5 h-5" />
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                /* Digital Key Page */
                <div className="space-y-6 animate-in fade-in duration-300">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Left Sidebar Card: Check-In Active */}
                    <div className="lg:col-span-4 bg-card border border-border rounded-3xl p-6 shadow-sm flex flex-col justify-between space-y-6">
                      <div className="text-center space-y-3 pt-4">
                        <div className="w-16 h-16 rounded-full bg-[#F3EDE4]/70 text-[#8B6748] flex items-center justify-center mx-auto border border-[#B89572]/30 shadow-xs">
                          <CheckCircle2 className="w-8 h-8" />
                        </div>
                        <div>
                          <h3 className="font-extrabold text-xl text-foreground">{t("checkin.checkInActiveTitle")}</h3>
                          <p className="text-xs text-muted-foreground mt-0.5">{t("checkin.digitalKeyIssuedSub")}</p>
                        </div>

                        <div className="space-y-3 bg-accent/30 p-4 rounded-2xl text-xs text-left mt-6 border border-border/50">
                          <div className="flex justify-between items-start">
                            <span className="text-muted-foreground font-medium">{t("reservations.guestName")}:</span>
                            <span className="font-bold text-right text-foreground">
                              {selectedReservation.guest ? `${selectedReservation.guest.firstName}\n${selectedReservation.guest.lastName}` : "Guest"}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground font-medium">Identity:</span>
                            <span className="font-bold text-emerald-600 dark:text-emerald-400">Identity Verified</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground font-medium">Payment:</span>
                            <span className="font-bold text-emerald-600 dark:text-emerald-400">Payment Confirmed</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground font-medium">Check-in:</span>
                            <span className="font-bold text-emerald-700 dark:text-emerald-400">{t("reservations.checkedIn")}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground font-medium">{t("checkin.assignedRoomLabel")}</span>
                            <span className="font-bold text-[#8B6748] font-mono">
                              {t("dashboard.rooms")} #{selectedReservation.roomNumber || selectedReservation.room?.room_number || selectedReservation.room?.number || selectedReservation.roomId || "Unavailable"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3 pb-2">
                        <div className="p-4 bg-[#F3EDE4]/70 border border-[#B89572]/40 rounded-2xl text-center shadow-sm">
                          <p className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">Digital Key Ready</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">Secure application credential for this stay</p>
                        </div>

                        <Button
                          onClick={handleDownloadCheckInDetails}
                          disabled={downloadingDetails}
                          variant="outline"
                          className="w-full rounded-xl text-xs font-bold gap-2 py-2.5"
                        >
                          {downloadingDetails ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download Check-In Details
                        </Button>
                      </div>
                    </div>

                    {/* Right Main Column */}
                    <div className="lg:col-span-8 space-y-6">
                      {/* Top Passcard Box */}
                      <div className="bg-gradient-to-br from-[#fffaf0] via-[#f3ede4] to-[#ead9c2] border border-[#B89572]/50 text-[#4a3022] rounded-3xl p-6 shadow-xl shadow-[#8B6748]/10 space-y-6">
                        <div className="flex justify-between items-center border-b border-[#B89572]/40 pb-4">
                          <div className="flex items-center gap-2.5">
                            <Smartphone className="w-5 h-5 text-[#8B6748]" />
                            <span className="font-bold text-sm tracking-wider uppercase text-[#6f4b36]">{t("checkin.contactlessPass")}</span>
                          </div>
                          <span className="text-[11px] px-3 py-1 rounded-full bg-white/70 text-[#6f4b36] border border-[#B89572]/50 font-mono font-bold">
                            SERVER-ISSUED
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-center">
                          <div className="sm:col-span-7 space-y-4">
                            <div>
                              <p className="text-[11px] text-[#80644d] uppercase font-semibold tracking-wider">{t("checkin.roomDoorPIN")}</p>
                              <div className="text-4xl font-mono font-extrabold tracking-widest text-[#8B6748] mt-1">
                                {keyDetails?.digitalPin || "Unavailable"}
                              </div>
                            </div>

                            <div className="space-y-1 text-xs text-[#6f4b36]">
                              <p><span className="text-[#80644d] font-medium">{t("checkin.lockId")}</span> <span className="font-mono text-[#4a3022]">{keyDetails?.lockId || "Unavailable"}</span></p>
                              <p><span className="text-[#80644d] font-medium">Credential status:</span> <span className="font-mono text-emerald-700">Server-issued and active</span></p>
                            </div>
                          </div>

                          <div className="sm:col-span-5 flex flex-col items-center justify-center p-4 bg-[#fffdf8] rounded-2xl border border-[#B89572]/60 text-center shadow-md">
                            <div className="bg-[#fffaf0] p-3 rounded-xl shadow-lg mb-2 border border-[#B89572]/50">
                              {qrCodeUrl && <img src={qrCodeUrl} alt="Secure digital access credential" className="w-52 h-52 object-contain" />}
                              {false && <svg className="w-24 h-24 text-slate-900" viewBox="0 0 29 29" fill="none" xmlns="http://www.w3.org/2000/svg">
                                {/* Top Left Finder Pattern */}
                                <rect x="1" y="1" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
                                <rect x="3" y="3" width="3" height="3" fill="currentColor" />
                                
                                {/* Top Right Finder Pattern */}
                                <rect x="21" y="1" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
                                <rect x="23" y="3" width="3" height="3" fill="currentColor" />
                                
                                {/* Bottom Left Finder Pattern */}
                                <rect x="1" y="21" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
                                <rect x="3" y="23" width="3" height="3" fill="currentColor" />

                                {/* High Density QR Code Matrix Modules */}
                                <rect x="10" y="1" width="2" height="2" fill="currentColor" />
                                <rect x="14" y="1" width="2" height="2" fill="currentColor" />
                                <rect x="17" y="1" width="2" height="2" fill="currentColor" />
                                <rect x="10" y="4" width="2" height="2" fill="currentColor" />
                                <rect x="13" y="4" width="3" height="2" fill="currentColor" />
                                <rect x="17" y="4" width="2" height="2" fill="currentColor" />
                                <rect x="9" y="7" width="2" height="2" fill="currentColor" />
                                <rect x="12" y="7" width="2" height="2" fill="currentColor" />
                                <rect x="15" y="7" width="4" height="2" fill="currentColor" />

                                <rect x="1" y="10" width="2" height="2" fill="currentColor" />
                                <rect x="4" y="10" width="2" height="2" fill="currentColor" />
                                <rect x="7" y="10" width="2" height="2" fill="currentColor" />
                                <rect x="10" y="10" width="4" height="4" fill="currentColor" />
                                <rect x="16" y="10" width="3" height="2" fill="currentColor" />
                                <rect x="20" y="10" width="2" height="2" fill="currentColor" />
                                <rect x="24" y="10" width="4" height="2" fill="currentColor" />

                                <rect x="1" y="13" width="3" height="2" fill="currentColor" />
                                <rect x="5" y="13" width="2" height="2" fill="currentColor" />
                                <rect x="15" y="13" width="2" height="2" fill="currentColor" />
                                <rect x="18" y="13" width="4" height="2" fill="currentColor" />
                                <rect x="23" y="13" width="2" height="2" fill="currentColor" />
                                <rect x="26" y="13" width="2" height="2" fill="currentColor" />

                                <rect x="1" y="16" width="2" height="2" fill="currentColor" />
                                <rect x="4" y="16" width="3" height="2" fill="currentColor" />
                                <rect x="9" y="15" width="2" height="4" fill="currentColor" />
                                <rect x="12" y="16" width="4" height="2" fill="currentColor" />
                                <rect x="17" y="16" width="2" height="2" fill="currentColor" />
                                <rect x="21" y="15" width="3" height="3" fill="currentColor" />
                                <rect x="25" y="16" width="3" height="2" fill="currentColor" />

                                <rect x="10" y="20" width="2" height="2" fill="currentColor" />
                                <rect x="13" y="19" width="3" height="3" fill="currentColor" />
                                <rect x="17" y="20" width="3" height="2" fill="currentColor" />
                                <rect x="21" y="19" width="2" height="2" fill="currentColor" />
                                <rect x="25" y="19" width="3" height="2" fill="currentColor" />

                                <rect x="10" y="23" width="3" height="2" fill="currentColor" />
                                <rect x="14" y="23" width="2" height="2" fill="currentColor" />
                                <rect x="17" y="23" width="2" height="4" fill="currentColor" />
                                <rect x="20" y="23" width="4" height="2" fill="currentColor" />
                                <rect x="25" y="22" width="3" height="3" fill="currentColor" />

                                <rect x="10" y="26" width="2" height="2" fill="currentColor" />
                                <rect x="13" y="26" width="3" height="2" fill="currentColor" />
                                <rect x="20" y="26" width="2" height="2" fill="currentColor" />
                                <rect x="23" y="26" width="5" height="2" fill="currentColor" />
                              </svg>}
                            </div>
                            <p className="text-xs font-bold text-[#6f4b36]">Scan to Access</p>
                            <p className="text-[10px] text-[#80644d] font-medium leading-tight mt-1">Secure Digital Access Credential</p>
                            <p className="text-[10px] text-[#80644d] font-medium leading-tight mt-2">Physical smart-lock integration is not connected.</p>
                          </div>
                        </div>
                      </div>

                      {/* Application key validation; no physical lock connection is claimed. */}
                      <div className="bg-[#fffaf0] border border-[#B89572]/40 rounded-3xl p-8 shadow-sm text-center space-y-6">
                        <div>
                          <h3 className="font-black text-xl flex items-center justify-center gap-2 text-foreground">
                            <Lock className="w-5 h-5 text-[#8B6748]" /> Application Key Validation
                          </h3>
                          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                            Validate the server-issued application credential for Room #{selectedReservation.roomNumber || selectedReservation.room?.room_number || selectedReservation.roomId || "Unavailable"}. Physical smart-lock integration is not connected.
                          </p>
                        </div>

                        <div className="flex flex-col items-center justify-center space-y-3 py-2">
                          <div className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-all ${
                            doorStatus === "UNLOCKED"
                              ? "bg-emerald-500/20 text-emerald-500 border border-emerald-500/30"
                              : "bg-[#f3ede4] text-[#8B6748] border border-[#B89572]/50"
                          }`}>
                            {doorStatus === "UNLOCKED" ? (
                              <Unlock className="w-10 h-10 text-emerald-500" />
                            ) : (
                              <Lock className="w-10 h-10 text-[#8B6748]" />
                            )}
                          </div>

                          <p className="text-sm font-bold text-foreground">
                            Credential status: <span className={doorStatus === "UNLOCKED" ? "text-emerald-500" : "text-slate-400 font-extrabold"}>{doorStatus === "UNLOCKED" ? "VALIDATED" : "NOT VALIDATED"}</span>
                          </p>
                        </div>

                        <Button
                          onClick={handleSimulateUnlock}
                          disabled={unlocking}
                          className="bg-[#8B6748] hover:bg-[#6B563E] text-white rounded-2xl text-xs font-extrabold px-8 py-3.5 gap-2 shadow-lg shadow-[#8B6748]/25 cursor-pointer"
                        >
                          {unlocking ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin" /> {t("checkin.unlocking")}
                            </>
                          ) : (
                            <>
                              Validate Application Key <KeyRound className="w-4 h-4" />
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
