export function ensureAuthenticated(req: any, res: any, next: any) {
    if (req.isAuthenticated()) {
      return next();
    }
    else res.redirect('/login');
  }

export function forwardAuthenticated(req: any, res: any, next: any) {
    if (!req.isAuthenticated()) {
      return next();
    }
    else{
      res.redirect('/mail')
    }
}