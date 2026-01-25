# Time Clock System

A comprehensive employee time clock system with manager controls, reporting, and manual punch capabilities.

## Features

### Employee Features
- **Clock In/Out**: Employees can clock in and out of work
- **Lunch Tracking**: Separate lunch in/out punches
- **View Records**: Employees can view their recent time records
- **Secure Login**: Individual employee accounts

### Manager Features
- **Employee Management**: Add and remove employees
- **Manual Punches**: Managers can manually punch employees in/out if they forget
- **Weekly Reports**: Generate detailed weekly reports showing hours worked
- **All Employee Access**: View and manage all employee records

### Additional Features
- **Session Management**: Secure login with session-based authentication
- **Role-Based Access**: Different interfaces for employees and managers
- **Database Storage**: MongoDB (DigitalOcean Managed MongoDB)
- **Responsive Design**: Works on desktop and mobile devices

## Setup Instructions

### Prerequisites
- Node.js (v14 or higher)
- npm (comes with Node.js)

### Installation

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start the Server**
   ```bash
   npm start
   ```

3. **Access the Application**
   - Open your browser and navigate to: `http://localhost:3000`

### Default Login Credentials

This project supports **multi-tenant** usage via `companyId` (the “apartment building” rule).

**Default Manager Account (optional seed):**
- If you set the following env vars, the server will create a manager user on startup if missing:
  - `DEFAULT_COMPANY_ID`
  - `DEFAULT_ADMIN_USERNAME`
  - `DEFAULT_ADMIN_PASSWORD`

**Employee Accounts:**
- When you add a new employee, the server generates a **temporary password** and returns it to the UI.
- Managers can change an employee’s password from the Edit Employee modal.

**Important:** Change these default passwords in production!

## Usage Guide

### For Employees

1. **Login**: Use your employee number as username and your password
2. **Clock In**: Click "Clock In" when you start work
3. **Lunch**: Click "Lunch Out" when you leave for lunch, then "Lunch In" when you return
4. **Clock Out**: Click "Clock Out" when you finish work
5. **View Records**: Your recent time records are displayed below the punch buttons

### For Managers

1. **Login**: Use the manager credentials
2. **Employee Management Tab**:
   - Click "Add Employee" to create new employee accounts
   - Click "Remove" next to an employee to deactivate them
3. **Manual Punch Tab**:
   - Select an employee
   - Choose the punch type (Clock In/Out, Lunch In/Out)
   - Add optional notes
   - Click "Submit Punch"
4. **Reports Tab**:
   - Select an employee (or leave as "All Employees")
   - Choose the week starting date (Monday)
   - Click "Generate Report" to see hours worked

## Database

The application uses MongoDB. Key collections include:

- **users**: Login credentials, roles, and `companyId`
- **employees**: Employee records, status, and `companyId`
- **punches**: Time punches tagged with `companyId`

## Security Notes

- Set `SESSION_SECRET` in your environment (required)
- Use strong passwords and rotate credentials regularly
- Consider using HTTPS in production
- For production scalability, consider using a persistent session store (e.g. Mongo-backed session store)

## Troubleshooting

- **Port Already in Use**: Change the PORT in `server.js` or set `PORT` environment variable
- **Database Errors**: Verify `DATABASE_URL` is a complete MongoDB connection string
- **Login Issues**: Verify your user exists for the correct `companyId`

## File Structure

```
.
├── server.js          # Backend server and API routes
├── package.json       # Dependencies and scripts
├── models/            # Mongoose schemas (blueprints)
├── controllers/       # Business logic + database queries
├── routes/            # Express route definitions
├── middleware/        # Session + companyId guards
├── .env.example       # Example environment variables (copy to your own .env)
├── public/
│   ├── index.html     # Main HTML file
│   ├── styles.css     # Styling
│   ├── app.js         # Frontend JavaScript (API-driven)
│   └── script.js      # Loader entrypoint (included by index.html)
└── README.md          # This file
```

## Future Enhancements

Potential features to consider:
- Email notifications
- Export reports to PDF/CSV
- Overtime calculations
- Break time tracking
- Multi-location support
- Time approval workflow
- Payroll integration

