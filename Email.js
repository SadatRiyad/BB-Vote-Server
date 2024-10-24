const { transporter } = require("./Email.confiq.js");
const { Verification_Email_Template } = require("./EmailTemplate.js");

const sendVerificationEmail = async (email, otp) => {
  try {
    const response = await transporter.sendMail({
      from: '"BB-Vote" <notify.bbvote@gmail.com>',
      to: email,
      subject: "Verify your Email with given OTP",
      text: "Verify your Email with given OTP",
      html: Verification_Email_Template.replace("{otp}", otp),
    });
    console.log("Email sent successfully", response);
  } catch (error) {
    console.error("Email error", error);
  }
};

module.exports = {
  sendVerificationEmail,
};
// export const senWelcomeEmail=async(email,name)=>{
//     try {
//      const response=   await transporter.sendMail({
//             from: '"BB-Vote" <notify.bbvote@gmail.com>',

//             to: email, // list of receivers
//             subject: "Welcome to BB-Vote", // Subject line
//             text: "Welcome to BB-Vote", // plain text body
//             html: Welcome_Email_Template.replace("{name}",name)
//         })
//         console.log('Email send Successfully',response)
//     } catch (error) {
//         console.log('Email error',error)
//     }
// }
