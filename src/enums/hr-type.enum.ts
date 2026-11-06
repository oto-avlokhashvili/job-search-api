/** What kind of recruiter an HR account is. Accounts made before this existed have none (= company). */
export enum HrType {
  /** Hires for the company they work at */
  COMPANY = 'COMPANY',
  /** Recruits for client companies: an agency or a freelance recruiter */
  OUTSOURCE = 'OUTSOURCE',
}
