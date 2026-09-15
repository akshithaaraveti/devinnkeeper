# InnKeeper – Hotel Management System

InnKeeper is a full-stack hotel management and guest check-in application designed to simplify hotel operations through a modern web-based platform.

The application provides an end-to-end workflow for managing reservations, guests, rooms, housekeeping, maintenance, payments, secure identity verification, digital check-in, digital keys, and notifications.

## 🚀 Features

### 🔐 Authentication & Role-Based Access
- Secure user authentication
- Login and signup
- Forgot password and reset password
- Role-based access control
- Different access levels for different hotel staff roles

### 🏨 Reservation Management
- Create new room reservations
- View reservation details
- Edit and update reservations
- Manage reservation status
- Manage guest and booking information
- Payment status tracking

### 👤 Guest Management
- Add and manage guest information
- View guest details
- Update guest information
- Maintain guest-related reservation data

### 🛏️ Room Management
- View available and occupied rooms
- Room details and status
- Room type and pricing information
- Room booking and assignment

### 🧹 Housekeeping Management
- Manage housekeeping tasks
- Track room cleaning status
- Assign and update housekeeping activities
- Monitor housekeeping operations

### 🔧 Maintenance Management
- Create and manage maintenance requests
- Assign maintenance tasks
- Track maintenance status
- Manage completed maintenance activities

### 🚗 Vehicle Management
- Manage hotel vehicle-related information
- Track vehicle requests and status
- Manage assignments where applicable

### 🪪 Face Identity Verification

InnKeeper uses **DeepFace** for secure face identity verification during the check-in process.

The verification flow is:

Driver Licence Image + Selfie  
↓  
Backend Verification API  
↓  
DeepFace  
↓  
ArcFace Face Recognition Model  
↓  
RetinaFace Face Detection  
↓  
Face Comparison  
↓  
Verified / Not Verified

The system compares the face present in the uploaded ID image with the guest's selfie.

> Note: DeepFace is used for face identity matching. It does not determine whether a driving licence document itself is authentic.

### 💳 Payment Integration
- Online payment support
- Razorpay integration
- Payment verification through the backend
- Payment status tracking
- Secure server-side payment handling

### 📱 Digital Check-In & Digital Key
- Secure check-in access
- Identity verification before check-in completion
- Digital key generation after successful verification and payment
- Room access information
- QR-based digital access credential
- Check-in details download

### 🔔 Notifications Center
- Centralized notification system
- Real-time/latest notification updates
- Unread notification count
- Mark individual notifications as read
- Mark all notifications as read
- Notifications for important hotel operations
- Role-based notification targeting

### 📊 Dashboard
- Hotel operation overview
- Reservation information
- Room status
- Guest information
- Notifications
- Quick access to important hotel management functions

## 🛠️ Technology Stack

### Frontend
- React
- TypeScript
- Vite
- Axios
- React-based UI components

### Backend
- Node.js
- Express.js
- Prisma ORM
- REST APIs

### Database
- PostgreSQL

### Face Verification
- Python
- DeepFace
- ArcFace
- RetinaFace

### Payments
- Razorpay

### Other Technologies
- Git & GitHub
- REST API
- JWT-based authentication
- Role-Based Access Control

## 📁 Project Structure

```text
InnKeeper/
│
├── backend/
│   ├── prisma/
│   ├── src/
│   │   ├── controllers/
│   │   ├── routes/
│   │   ├── services/
│   │   └── utils/
│   │
│   └── face-verification/
│       ├── app.py
│       └── requirements.txt
│
├── frontend/
│   ├── client/
│   │   └── src/
│   │       ├── components/
│   │       ├── contexts/
│   │       └── pages/
│   │
│   └── ...
│
└── README.md
