import { AnimatePresence, motion } from 'framer-motion';
import { Check, Eye, EyeOff, Loader2, Mail, Phone, ShieldCheck, Sparkles, UserRound, ConciergeBell } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthContext } from '@/contexts/AuthContext';
import introBg from '@/assets/intro_bg.png';

const roleOptions = [
  { label: 'Admin (Hotel Configuration & Structure)', value: 'admin' },
  { label: 'Manager (Hotel Operations)', value: 'manager' },
  { label: 'Receptionist (Front Desk)', value: 'receptionist' },
];

export interface CountryCode {
  code: string;
  name: string;
  flag: string;
  dialCode: string;
  digitsLength: number;
  regex: RegExp;
  placeholder: string;
  errorMessage: string;
}

export const COUNTRY_CODES: CountryCode[] = [
  {
    code: 'IN',
    name: 'India',
    flag: '🇮🇳',
    dialCode: '+91',
    digitsLength: 10,
    regex: /^[6-9][0-9]{9}$/,
    placeholder: '9876543210',
    errorMessage: 'Phone number must be a valid 10-digit number'
  },
  {
    code: 'US',
    name: 'United States',
    flag: '🇺🇸',
    dialCode: '+1',
    digitsLength: 10,
    regex: /^[2-9][0-9]{9}$/,
    placeholder: '2025550143',
    errorMessage: 'Phone number must be a valid 10-digit number'
  },
  {
    code: 'GB',
    name: 'United Kingdom',
    flag: '🇬🇧',
    dialCode: '+44',
    digitsLength: 10,
    regex: /^[0-9]{10}$/,
    placeholder: '7911123456',
    errorMessage: 'Phone number must be a valid 10-digit  number.'
  },
  {
    code: 'CA',
    name: 'Canada',
    flag: '🇨🇦',
    dialCode: '+1',
    digitsLength: 10,
    regex: /^[2-9][0-9]{9}$/,
    placeholder: '4165550123',
    errorMessage: 'Phone number must be a valid 10-digit  number.'
  },
  {
    code: 'AU',
    name: 'Australia',
    flag: '🇦🇺',
    dialCode: '+61',
    digitsLength: 9,
    regex: /^[0-9]{9}$/,
    placeholder: '412345678',
    errorMessage: 'Phone number must be a valid 9-digit number.'
  },
  {
    code: 'AE',
    name: 'UAE',
    flag: '🇦🇪',
    dialCode: '+971',
    digitsLength: 9,
    regex: /^[0-9]{9}$/,
    placeholder: '501234567',
    errorMessage: 'Phone number must be a valid 9-digit number.'
  },
  {
    code: 'SG',
    name: 'Singapore',
    flag: '🇸🇬',
    dialCode: '+65',
    digitsLength: 8,
    regex: /^[89][0-9]{7}$/,
    placeholder: '81234567',
    errorMessage: 'Phone number must be a valid 8-digit number'
  },
  {
    code: 'DE',
    name: 'Germany',
    flag: '🇩🇪',
    dialCode: '+49',
    digitsLength: 11,
    regex: /^[0-9]{10,11}$/,
    placeholder: '15123456789',
    errorMessage: 'Phone number must be a valid 10 or 11-digit number.'
  }
];

export const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

export const EMAIL_ERROR_MSG = "Please enter a valid email address (e.g. username@domain.com).";
export const PASSWORD_ERROR_MSG = "Password must be at least 8 characters and contain one uppercase letter, one lowercase letter, one number, and one special character.";

export default function SignupPage() {
  const [, setLocation] = useLocation();
  const { signup, logout, loading, isAuthenticated } = useAuthContext();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(COUNTRY_CODES[0]); // Default India +91
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirmPassword: '', role: 'manager' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (isAuthenticated) {
      setLocation('/');
    }
  }, [isAuthenticated, setLocation]);

  if (isAuthenticated) {
    return null;
  }

  const validateField = (name: string, value: string, currentForm = form, country = selectedCountry) => {
    let error = '';
    if (name === 'name') {
      if (!value.trim()) error = 'Full name is required.';
      else if (!/^[a-zA-Z\s]{2,}$/.test(value.trim())) error = 'Full name must contain only letters and spaces.';
    } else if (name === 'email') {
      if (!value.trim()) error = 'Email is required.';
      else if (!EMAIL_REGEX.test(value.trim())) error = EMAIL_ERROR_MSG;
    } else if (name === 'phone') {
      const trimmedPhone = value.trim();
      if (!trimmedPhone) {
        error = 'Phone number is required.';
      } else {
        const cleanDigits = trimmedPhone.startsWith(country.dialCode)
          ? trimmedPhone.slice(country.dialCode.length).trim().replace(/\D/g, '')
          : trimmedPhone.replace(/\D/g, '');

        if (!country.regex.test(cleanDigits)) {
          error = country.errorMessage;
        }
      }
    } else if (name === 'password') {
      if (!value) error = 'Password is required.';
      else if (!PASSWORD_REGEX.test(value)) {
        error = PASSWORD_ERROR_MSG;
      }
    } else if (name === 'confirmPassword') {
      if (!value) error = 'Please confirm your password.';
      else if (value !== currentForm.password) error = 'Passwords do not match.';
    }
    return error;
  };

  const validate = (country = selectedCountry) => {
    const nextErrors: Record<string, string> = {};
    const nameErr = validateField('name', form.name, form, country);
    if (nameErr) nextErrors.name = nameErr;

    const emailErr = validateField('email', form.email, form, country);
    if (emailErr) nextErrors.email = emailErr;

    const phoneErr = validateField('phone', form.phone, form, country);
    if (phoneErr) nextErrors.phone = phoneErr;

    const pwdErr = validateField('password', form.password, form, country);
    if (pwdErr) nextErrors.password = pwdErr;

    const confirmErr = validateField('confirmPassword', form.confirmPassword, form, country);
    if (confirmErr) nextErrors.confirmPassword = confirmErr;

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleChange = (field: string, value: string) => {
    const updatedForm = { ...form, [field]: value };
    setForm(updatedForm);

    if (touched[field]) {
      const err = validateField(field, value, updatedForm);
      setErrors((prev) => ({ ...prev, [field]: err }));
    }

    if (field === 'password' && touched.confirmPassword) {
      const confirmErr = validateField('confirmPassword', updatedForm.confirmPassword, updatedForm);
      setErrors((prev) => ({ ...prev, confirmPassword: confirmErr }));
    }
  };

  const handleCountryChange = (countryCode: string) => {
    const newCountry = COUNTRY_CODES.find((c) => c.code === countryCode) || COUNTRY_CODES[0];
    setSelectedCountry(newCountry);
    if (touched.phone) {
      const err = validateField('phone', form.phone, form, newCountry);
      setErrors((prev) => ({ ...prev, phone: err }));
    }
  };

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const err = validateField(field, form[field as keyof typeof form]);
    setErrors((prev) => ({ ...prev, [field]: err }));
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setTouched({ name: true, email: true, phone: true, password: true, confirmPassword: true });
    if (!validate()) return;
    setSubmitting(true);
    try {
      const fullPhone = `${selectedCountry.dialCode} ${form.phone.trim()}`;
      await signup({ ...form, phone: fullPhone, role: form.role.toLowerCase() });
      toast.success('Account created successfully! Please sign in with your password.');
      setLocation(`/login?email=${encodeURIComponent(form.email.trim())}`);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Signup failed.';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#EEE7DD] p-4 text-[#3F352D] sm:p-6 lg:p-8">
      <div className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-90" style={{ backgroundImage: `url(${introBg})` }} />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#F3EDE4]/65 via-[#EEE7DD]/70 to-[#E8DED2]/75 backdrop-blur-[1px]" />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col">
        <header className="flex items-center justify-between px-2 py-2 sm:px-4">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#8B6748] text-[#F8F4EE] shadow-md">
              <ConciergeBell className="h-5 w-5" />
            </span>
            <span>
              <span className="block font-serif text-xl font-bold text-[#3F352D]">Motel Innkeeper</span>
              <span className="block text-[9px] font-bold uppercase tracking-[0.25em] text-[#8B6748]">Comfort • Stay • Relax</span>
            </span>
          </Link>
          <span className="hidden text-[10px] font-bold uppercase tracking-[0.22em] text-[#6F6258]/70 sm:block">Property Management System</span>
        </header>
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="my-auto grid w-full gap-6 overflow-hidden rounded-[32px] border border-[#E8DED2] bg-[#F8F4EE]/80 p-3 shadow-[0_25px_80px_rgba(63,53,45,0.14)] backdrop-blur-xl lg:grid-cols-[0.95fr_1.05fr] lg:p-5">
          <div className="hidden flex-col justify-between rounded-[24px] bg-[#8B6748]/90 p-8 text-[#F8F4EE] lg:flex">
            <div>
              <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/20 bg-white/15">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-[#E8DED2]">Create account</p>
              <h1 className="font-serif text-4xl font-bold leading-tight">Make every stay feel cared for.</h1>
            </div>
            <div className="rounded-2xl border border-[#F8F4EE]/30 bg-[#F8F4EE]/10 p-5 backdrop-blur">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[#F8F4EE]">
                <Sparkles className="h-4 w-4" />
                Elegant access control
              </div>
              <p className="text-sm text-[#F8F4EE]/85">Set role-based permissions while keeping the front desk experience warm and effortless.</p>
            </div>
          </div>

          <div className="rounded-[24px] border border-[#E8DED2] bg-[#FAF7F2]/95 p-6 shadow-inner shadow-[#B89572]/20 sm:p-8">
            <div className="mb-6 text-center lg:text-left">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary lg:mx-0">
                <UserRound className="h-6 w-6" />
              </div>
              <h2 className="font-serif text-3xl font-bold text-[#3F352D]">Join Motel Innkeeper</h2>
              <p className="mt-2 text-sm text-[#6F6258]">Create a polished account for your hospitality team.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate autoComplete="off">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  onBlur={() => handleBlur('name')}
                  placeholder="Taylor Brooks"
                  autoComplete="off"
                />
                {errors.name ? <p className="text-sm text-red-500">{errors.name}</p> : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => handleChange('email', e.target.value)}
                    onBlur={() => handleBlur('email')}
                    className="pl-10"
                    placeholder="example@gmail.com"
                    autoComplete="off"
                  />
                </div>
                {errors.email ? <p className="text-sm text-red-500">{errors.email}</p> : null}
              </div>

              {/* Phone Number with Country Code Dropdown */}
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <div className="flex rounded-md border border-input shadow-sm focus-within:ring-1 focus-within:ring-ring">
                  {/* Country Selector Dropdown */}
                  <select
                    value={selectedCountry.code}
                    onChange={(e) => handleCountryChange(e.target.value)}
                    className="h-10 rounded-l-md border-r bg-muted/60 px-2.5 py-2 text-xs font-semibold outline-none hover:bg-muted cursor-pointer"
                  >
                    {COUNTRY_CODES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.flag} {c.dialCode} ({c.name})
                      </option>
                    ))}
                  </select>

                  <div className="relative flex-1">
                    <Input
                      id="phone"
                      type="tel"
                      maxLength={selectedCountry.digitsLength + 2}
                      value={form.phone}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, '').slice(0, selectedCountry.digitsLength);
                        handleChange('phone', raw);
                      }}
                      onBlur={() => handleBlur('phone')}
                      className="h-10 border-0 rounded-l-none pl-3 shadow-none focus-visible:ring-0"
                      placeholder={`e.g. ${selectedCountry.placeholder}`}
                      autoComplete="off"
                    />
                  </div>
                </div>
                {errors.phone ? <p className="text-sm text-red-500">{errors.phone}</p> : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={(e) => handleChange('password', e.target.value)}
                      onBlur={() => handleBlur('password')}
                      placeholder="Create password"
                      autoComplete="new-password"
                    />
                    <button type="button" onClick={() => setShowPassword((prev) => !prev)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.password ? <p className="text-sm text-red-500">{errors.password}</p> : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={form.confirmPassword}
                      onChange={(e) => handleChange('confirmPassword', e.target.value)}
                      onBlur={() => handleBlur('confirmPassword')}
                      placeholder="Confirm password"
                      autoComplete="new-password"
                    />
                    <button type="button" onClick={() => setShowConfirmPassword((prev) => !prev)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.confirmPassword ? <p className="text-sm text-red-500">{errors.confirmPassword}</p> : null}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <select id="role" value={form.role} onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm font-medium">
                  {roleOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>

              <Button type="submit" className="w-full rounded-full bg-[#8B6748] text-[#F8F4EE] shadow-lg shadow-[#8B6748]/20 hover:bg-[#755539]" disabled={loading || submitting}>
                {loading || submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating account...</> : <>Create Account <Check className="ml-2 h-4 w-4" /></>}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-slate-600">
              Already have an account? <Link href="/login" className="font-semibold text-[#2f6c85]">Login</Link>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
