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
- **Database Storage**: SQLite database for data persistence
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

**Manager Account:**
- Username: `admin`
- Password: `admin123`

**Note:** When you add new employees, they will be created with:
- Username: Their employee number
- Password: `password123`

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

The application uses SQLite and creates a database file (`timeclock.db`) automatically on first run. The database includes:

- **users**: Login credentials and roles
- **employees**: Employee information
- **time_records**: All time punches with timestamps

## Security Notes

- Default passwords should be changed in production
- The session secret in `server.js` should be changed for production use
- Consider using HTTPS in production
- Regularly backup the `timeclock.db` file

## Troubleshooting

- **Port Already in Use**: Change the PORT in `server.js` or set `PORT` environment variable
- **Database Errors**: Delete `timeclock.db` to reset (this will delete all data)
- **Login Issues**: Check that the database was initialized correctly

## File Structure

```
.
├── server.js          # Backend server and API routes
├── package.json       # Dependencies and scripts
├── timeclock.db       # SQLite database (created automatically)
├── public/
│   ├── index.html     # Main HTML file
│   ├── styles.css     # Styling
│   └── app.js         # Frontend JavaScript
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

